export const environment = {
  production: true,
  defaultTarget: 'https://dl.tntu.edu.ua',
  port: 3000,
  forwardProxies: [
    'http://localhost:8787',
    'http://localhost:8788',
    'http://localhost:8789',
  ] as string[],
  sessionTtlMs: 60 * 60 * 1000,
  iframePermissions: [
    'camera',
    'microphone',
    'geolocation',
    'autoplay',
    'fullscreen',
    'clipboard-read',
    'clipboard-write',
    'display-capture',
    'encrypted-media',
    'picture-in-picture',
  ],
};
