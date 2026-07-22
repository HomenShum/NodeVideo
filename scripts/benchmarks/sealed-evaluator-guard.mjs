export function assertPostFreezeEvaluatorAccess({ sealed, credential, freeze }) {
  if (!sealed) return;
  if (!freeze?.id || !freeze?.frozenAt)
    throw new Error('Sealed evaluation requires a valid freeze receipt.');
  if (!credential || credential.length < 24) {
    throw new Error(
      'Sealed evaluation requires the post-freeze NODEVIDEO_CREATORBENCH_EVALUATOR_TOKEN credential plane.',
    );
  }
}

export function assertFrozenPrivateCatalog(freeze, observedCatalogHash) {
  if (freeze.privateSplit?.catalogHash !== observedCatalogHash) {
    throw new Error('Private held-out catalog does not match the frozen hash.');
  }
}
