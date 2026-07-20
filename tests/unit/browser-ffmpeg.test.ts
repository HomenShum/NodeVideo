import { describe, expect, it, vi } from 'vitest';
import {
  type BrowserFfmpegInstance,
  BrowserFfmpegRuntime,
  canUseMultithread,
  coreLoadConfig,
} from '../../src/lib/browser-ffmpeg';

class FakeFfmpeg implements BrowserFfmpegInstance {
  readonly files = new Map<string, Uint8Array | string>();
  readonly deleted: string[] = [];
  readonly loadConfigs: unknown[] = [];
  readonly execArgs: string[][] = [];
  readonly listeners = new Set<(event: { type: string; message: string }) => void>();
  terminated = false;
  failLoad = false;
  exitCode = 0;
  output = new Uint8Array([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70]);
  pendingReject: ((error: Error) => void) | null = null;
  holdExec = false;

  async load(config: unknown): Promise<boolean> {
    this.loadConfigs.push(config);
    if (this.failLoad) throw new Error('pthread unavailable');
    return true;
  }

  async exec(args: string[]): Promise<number> {
    this.execArgs.push(args);
    for (const listener of this.listeners) {
      listener({ type: 'stdout', message: 'frame=5' });
      listener({ type: 'stdout', message: 'out_time_ms=500000' });
    }
    if (this.holdExec) {
      return new Promise<number>((_resolve, reject) => {
        this.pendingReject = reject;
      });
    }
    return this.exitCode;
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<boolean> {
    this.files.set(path, data);
    return true;
  }

  async readFile(): Promise<Uint8Array> {
    return this.output;
  }

  async deleteFile(path: string): Promise<boolean> {
    this.deleted.push(path);
    this.files.delete(path);
    return true;
  }

  on(_event: 'log', callback: (event: { type: string; message: string }) => void): void {
    this.listeners.add(callback);
  }

  off(_event: 'log', callback: (event: { type: string; message: string }) => void): void {
    this.listeners.delete(callback);
  }

  terminate(): void {
    this.terminated = true;
    this.pendingReject?.(new Error('called FFmpeg.terminate()'));
  }
}

describe('browser FFmpeg runtime', () => {
  it('selects only the multithread core in a cross-origin-isolated environment', () => {
    expect(canUseMultithread({ crossOriginIsolated: true, SharedArrayBuffer: class {} })).toBe(
      true,
    );
    expect(canUseMultithread({ crossOriginIsolated: false, SharedArrayBuffer: class {} })).toBe(
      false,
    );
    expect(coreLoadConfig('multi-thread')).toMatchObject({
      coreURL: '/ffmpeg/0.12.10/mt/ffmpeg-core.js',
      wasmURL: '/ffmpeg/0.12.10/mt/ffmpeg-core.wasm',
      workerURL: '/ffmpeg/0.12.10/mt/ffmpeg-core.worker.js',
    });
    expect(coreLoadConfig('single-thread')).not.toHaveProperty('workerURL');
  });

  it('writes, executes, reports progress, reads, and cleans a job', async () => {
    const ffmpeg = new FakeFfmpeg();
    const onProgress = vi.fn();
    const runtime = new BrowserFfmpegRuntime({
      factory: async () => ffmpeg,
      environment: { crossOriginIsolated: false },
    });

    const result = await runtime.execute({
      args: ['-i', 'input.mp4', 'output.mp4'],
      files: [{ name: 'input.mp4', data: new Uint8Array([1, 2, 3]) }],
      outputFile: 'output.mp4',
      expectedFrames: 10,
      durationSeconds: 1,
      onProgress,
    });

    expect(result).toEqual({ data: ffmpeg.output, coreKind: 'single-thread' });
    expect(ffmpeg.loadConfigs[0]).toEqual(coreLoadConfig('single-thread'));
    expect(ffmpeg.execArgs[0]).toEqual(['-i', 'input.mp4', 'output.mp4']);
    expect(ffmpeg.deleted).toEqual(['input.mp4', 'output.mp4']);
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'rendering', frame: 5 }),
    );
    expect(onProgress).toHaveBeenLastCalledWith({
      phase: 'complete',
      ratio: 1,
      coreKind: 'single-thread',
    });
  });

  it('falls back to the single-thread core if pthread loading fails', async () => {
    const multithread = new FakeFfmpeg();
    multithread.failLoad = true;
    const singleThread = new FakeFfmpeg();
    const instances = [multithread, singleThread];
    const runtime = new BrowserFfmpegRuntime({
      factory: async () => instances.shift() ?? singleThread,
      environment: { crossOriginIsolated: true, SharedArrayBuffer: class {} },
      preferMultiThread: true,
    });

    const result = await runtime.execute({
      args: ['output.mp4'],
      files: [],
      outputFile: 'output.mp4',
    });

    expect(multithread.terminated).toBe(true);
    expect(singleThread.loadConfigs[0]).toEqual(coreLoadConfig('single-thread'));
    expect(result.coreKind).toBe('single-thread');
  });

  it('times out a stalled pthread load and falls back to the single-thread core', async () => {
    const multithread = new FakeFfmpeg();
    multithread.load = async () => new Promise<boolean>(() => undefined);
    const singleThread = new FakeFfmpeg();
    const instances = [multithread, singleThread];
    const runtime = new BrowserFfmpegRuntime({
      factory: async () => instances.shift() ?? singleThread,
      environment: { crossOriginIsolated: true, SharedArrayBuffer: class {} },
      preferMultiThread: true,
      multiThreadLoadTimeoutMs: 5,
    });

    const result = await runtime.execute({
      args: ['output.mp4'],
      files: [],
      outputFile: 'output.mp4',
    });

    expect(multithread.terminated).toBe(true);
    expect(singleThread.loadConfigs[0]).toEqual(coreLoadConfig('single-thread'));
    expect(result.coreKind).toBe('single-thread');
  });

  it('terminates the active worker when cancelled', async () => {
    const ffmpeg = new FakeFfmpeg();
    ffmpeg.holdExec = true;
    const runtime = new BrowserFfmpegRuntime({ factory: async () => ffmpeg });
    const execution = runtime.execute({
      args: ['output.mp4'],
      files: [],
      outputFile: 'output.mp4',
    });
    await vi.waitFor(() => expect(ffmpeg.execArgs).toHaveLength(1));
    runtime.cancel();

    await expect(execution).rejects.toMatchObject({ name: 'AbortError' });
    expect(ffmpeg.terminated).toBe(true);
    expect(runtime.isBusy).toBe(false);
  });

  it('fails closed on unsafe paths and excessive input bytes', async () => {
    const runtime = new BrowserFfmpegRuntime({
      factory: async () => new FakeFfmpeg(),
      maxInputBytes: 2,
    });
    await expect(
      runtime.execute({ args: ['out.mp4'], files: [], outputFile: '../out.mp4' }),
    ).rejects.toThrow(/safe MEMFS filename/u);
    await expect(
      runtime.execute({
        args: ['out.mp4'],
        files: [{ name: 'in.mp4', data: new Uint8Array([1, 2, 3]) }],
        outputFile: 'out.mp4',
      }),
    ).rejects.toThrow(/memory safety limit/u);
  });
});
