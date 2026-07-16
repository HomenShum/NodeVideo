import {
  type ContentKind,
  type CreatorTasteProfile,
  type ProductionAudit,
  type TargetSpecConsistencyReport,
  validateCreatorTasteProfile,
  validateProductionAudit,
  validateTargetSpecConsistencyReport,
} from './creator-taste-contracts';
import {
  type CreativeFidelityReport,
  validateCreativeFidelityReport,
} from './creator-taste-evaluator';
import {
  type CandidateAdmission,
  type NodeWorkflowRequest,
  type NodeWorkflowResult,
  inspectNodeWorkflowCandidate,
} from './workflowExecutionPort';

export interface CreatorTasteWorkflowCandidate {
  kind: 'creator-taste-and-production-audit';
  projectId: string;
  profile: CreatorTasteProfile;
  audits: ProductionAudit[];
  consistencyReports: TargetSpecConsistencyReport[];
  evaluationReady: boolean;
}

/**
 * Admits analysis-only taste artifacts from NodeAgent. The application still
 * owns persistence, review, profile activation, and every media/render write.
 */
export function inspectCreatorTasteWorkflowCandidate(args: {
  request: NodeWorkflowRequest;
  result: NodeWorkflowResult<CreatorTasteWorkflowCandidate>;
  expectedAppCommit: string;
  expectedProjectId: string;
  allowedContentKinds?: readonly ContentKind[];
  digestCandidate: (candidate: CreatorTasteWorkflowCandidate) => string | Promise<string>;
  now?: () => Date;
}): Promise<CandidateAdmission<CreatorTasteWorkflowCandidate>> {
  return inspectNodeWorkflowCandidate({
    request: args.request,
    result: args.result,
    expectedApp: 'nodevideo',
    expectedAppCommit: args.expectedAppCommit,
    digestCandidate: args.digestCandidate,
    validateCandidate: (candidate) =>
      validateCreatorTasteWorkflowCandidate(
        candidate,
        args.expectedProjectId,
        args.allowedContentKinds,
      ),
    now: args.now,
  });
}

export function validateCreatorTasteWorkflowCandidate(
  candidate: CreatorTasteWorkflowCandidate,
  expectedProjectId: string,
  allowedContentKinds?: readonly ContentKind[],
): string[] {
  const issues: string[] = [];
  if (candidate?.kind !== 'creator-taste-and-production-audit') {
    return ['Creator taste candidate has an unsupported kind.'];
  }
  if (candidate.projectId !== expectedProjectId) {
    issues.push('Creator taste candidate crossed the expected project boundary.');
  }
  try {
    validateCreatorTasteProfile(candidate.profile);
  } catch (error) {
    issues.push(`Creator taste profile is invalid: ${message(error)}`);
  }
  if (!Array.isArray(candidate.audits) || candidate.audits.length === 0) {
    issues.push('Creator taste candidate requires at least one production audit.');
    return issues;
  }
  const auditIds = new Set<string>();
  for (const audit of candidate.audits) {
    try {
      validateProductionAudit(audit);
      if (auditIds.has(audit.id)) issues.push(`Duplicate production audit: ${audit.id}.`);
      auditIds.add(audit.id);
      if (allowedContentKinds && !allowedContentKinds.includes(audit.contentKind)) {
        issues.push(`Production audit ${audit.id} has a disallowed content kind.`);
      }
    } catch (error) {
      issues.push(`Production audit is invalid: ${message(error)}`);
    }
  }
  const sourceIds = [...(candidate.profile?.sourceProductionIds ?? [])].sort();
  if (JSON.stringify(sourceIds) !== JSON.stringify([...auditIds].sort())) {
    issues.push('Profile source productions must exactly match the admitted audits.');
  }
  const reportIds = new Set<string>();
  for (const report of candidate.consistencyReports ?? []) {
    try {
      validateTargetSpecConsistencyReport(report);
      if (reportIds.has(report.auditId)) {
        issues.push(`Duplicate target-spec consistency report: ${report.auditId}.`);
      }
      reportIds.add(report.auditId);
      if (!auditIds.has(report.auditId)) {
        issues.push(`Target-spec consistency report ${report.auditId} has no admitted audit.`);
      }
    } catch (error) {
      issues.push(`Target-spec consistency report is invalid: ${message(error)}`);
    }
  }
  if (reportIds.size !== auditIds.size) {
    issues.push('Every production audit requires exactly one target-spec consistency report.');
  }
  const computedReady =
    reportIds.size === auditIds.size &&
    candidate.consistencyReports.every((report) => report.status === 'pass');
  if (candidate.evaluationReady !== computedReady) {
    issues.push('evaluationReady does not match the conjunctive target-spec consistency gate.');
  }
  return [...new Set(issues)];
}

/** Admit the isolated post-freeze evaluator result through the same NodeAgent envelope. */
export function inspectCreativeFidelityWorkflowCandidate(args: {
  request: NodeWorkflowRequest;
  result: NodeWorkflowResult<CreativeFidelityReport>;
  expectedAppCommit: string;
  expectedCandidateArtifactId: string;
  expectedReferenceAuditId: string;
  digestCandidate: (report: CreativeFidelityReport) => string | Promise<string>;
  now?: () => Date;
}): Promise<CandidateAdmission<CreativeFidelityReport>> {
  return inspectNodeWorkflowCandidate({
    request: args.request,
    result: args.result,
    expectedApp: 'nodevideo',
    expectedAppCommit: args.expectedAppCommit,
    digestCandidate: args.digestCandidate,
    validateCandidate: (report) => {
      const issues: string[] = [];
      try {
        validateCreativeFidelityReport(report);
      } catch (error) {
        issues.push(`Creative fidelity report is invalid: ${message(error)}`);
        return issues;
      }
      if (report.candidateArtifactId !== args.expectedCandidateArtifactId) {
        issues.push('Creative fidelity report crossed the frozen candidate boundary.');
      }
      if (report.referenceAuditId !== args.expectedReferenceAuditId) {
        issues.push('Creative fidelity report crossed the reference-audit boundary.');
      }
      return issues;
    },
    now: args.now,
  });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
