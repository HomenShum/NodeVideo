import { useEffect, useState } from 'react';

export const LOCAL_PREVIEW_URL = '/__nodevideo_local/full-preview.mp4';

export function useLocalPreview() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const controller = new AbortController();
    void fetch(LOCAL_PREVIEW_URL, { method: 'HEAD', signal: controller.signal })
      .then((response) =>
        setAvailable(response.ok && response.headers.get('content-type') === 'video/mp4'),
      )
      .catch(() => setAvailable(false));
    return () => controller.abort();
  }, []);
  return available;
}
