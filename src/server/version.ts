// The bundler inlines this JSON at build time, so the standalone image needs no package.json at run time.
import pkg from '../../package.json';

export const APP_VERSION: string = pkg.version;
