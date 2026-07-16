import { defaultBackend, defineSandbox } from 'eve/sandbox';
export default defineSandbox({
  backend: defaultBackend({ vercel: { networkPolicy: 'deny-all' } }),
});
