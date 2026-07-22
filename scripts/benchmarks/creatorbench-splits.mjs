export function assignCreatorDisjointSplits(records, splitPercentages, stableNumber) {
  const groups = new Map();
  for (const record of records) {
    groups.set(record.creatorId, [...(groups.get(record.creatorId) ?? []), record]);
  }
  const remaining = [...groups.entries()];
  const desired = {
    'private-heldout': Math.ceil((records.length * splitPercentages['private-heldout']) / 100),
    adversarial: Math.ceil((records.length * splitPercentages.adversarial) / 100),
    'public-test': Math.ceil((records.length * splitPercentages['public-test']) / 100),
  };
  const counts = { development: 0, 'public-test': 0, 'private-heldout': 0, adversarial: 0 };
  const assignment = new Map();
  const domainsBySplit = new Map();

  for (const split of ['private-heldout', 'adversarial', 'public-test']) {
    const splitDomains = new Set();
    domainsBySplit.set(split, splitDomains);
    while (counts[split] < desired[split] && remaining.length) {
      remaining.sort(([leftId, leftRecords], [rightId, rightRecords]) => {
        const leftNewDomains = new Set(
          leftRecords.map((record) => record.domain).filter((domain) => !splitDomains.has(domain)),
        ).size;
        const rightNewDomains = new Set(
          rightRecords.map((record) => record.domain).filter((domain) => !splitDomains.has(domain)),
        ).size;
        return (
          leftRecords.length - rightRecords.length ||
          rightNewDomains - leftNewDomains ||
          stableNumber(leftId) - stableNumber(rightId)
        );
      });
      const [creatorId, creatorRecords] = remaining.shift();
      assignment.set(creatorId, split);
      counts[split] += creatorRecords.length;
      for (const record of creatorRecords) splitDomains.add(record.domain);
    }
  }
  for (const [creatorId, creatorRecords] of remaining) {
    assignment.set(creatorId, 'development');
    counts.development += creatorRecords.length;
  }
  return assignment;
}

function visualDistance(left, right) {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  let xor = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let distance = 0;
  while (xor) {
    distance += Number(xor & 1n);
    xor >>= 1n;
  }
  return distance;
}

export function assignIsolationDisjointSplits(records, splitPercentages, stableNumber) {
  const parent = new Map(records.map((record) => [record.id, record.id]));
  const find = (id) => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    let cursor = id;
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor);
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };
  for (let leftIndex = 0; leftIndex < records.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < records.length; rightIndex += 1) {
      const left = records[leftIndex];
      const right = records[rightIndex];
      const sameCreator = left.creatorId === right.creatorId;
      const sameSourceGroup = left.relatedSourceGroup === right.relatedSourceGroup;
      const sameSourceHash = left.sourceSha256 === right.sourceSha256;
      const sameAudio =
        left.audioFingerprint &&
        left.audioFingerprint !== 'no-audio' &&
        left.audioFingerprint === right.audioFingerprint;
      const nearVisual = visualDistance(left.visualPerceptualHash, right.visualPerceptualHash) <= 4;
      if (sameCreator || sameSourceGroup || sameSourceHash || sameAudio || nearVisual) {
        union(left.id, right.id);
      }
    }
  }
  const groups = new Map();
  for (const record of records) {
    const root = find(record.id);
    groups.set(root, [...(groups.get(root) ?? []), record]);
  }
  const proxyRecords = [...groups.entries()].map(([groupId, groupRecords]) => ({
    id: groupId,
    creatorId: groupId,
    domain: groupRecords[0].domain,
    records: groupRecords,
  }));
  const expanded = proxyRecords.flatMap((group) =>
    group.records.map((record) => ({ ...record, creatorId: group.id })),
  );
  const groupAssignments = assignCreatorDisjointSplits(expanded, splitPercentages, stableNumber);
  return new Map(
    proxyRecords.flatMap((group) =>
      group.records.map((record) => [record.id, groupAssignments.get(group.id)]),
    ),
  );
}
