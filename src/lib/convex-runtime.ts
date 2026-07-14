import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../convex/_generated/api';

export type ControlPlaneStatus = 'checking' | 'online' | 'unconfigured' | 'unreachable';

export async function verifyConvexControlPlane(): Promise<ControlPlaneStatus> {
  const deploymentUrl = import.meta.env.VITE_CONVEX_URL;
  if (!deploymentUrl) return 'unconfigured';
  try {
    const client = new ConvexHttpClient(deploymentUrl);
    await client.query(api.runtimeSources.list, {});
    return 'online';
  } catch {
    return 'unreachable';
  }
}
