import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.animato.whineam',
  appName: 'Whine am',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    url: 'https://albertduomotimi778-byte.github.io/whine-am/',
    allowNavigation: [
      'albertduomotimi778-byte.github.io',
      '*.github.io',
      '*.run.app'
    ]
  }
};

export default config;
