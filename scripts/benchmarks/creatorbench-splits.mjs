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
