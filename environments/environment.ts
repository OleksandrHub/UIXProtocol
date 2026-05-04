export const environment = {
  production: false,
  defaultTarget: 'https://dl.tntu.edu.ua',
  port: 3000,
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
