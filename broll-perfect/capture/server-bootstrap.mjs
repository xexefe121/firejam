// Seed only this throwaway process. App files remain untouched.
let seed = 0xf17e2026;
Math.random = () => {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  return (seed >>> 0) / 4294967296;
};
// A capture-local mirror avoids downloads into server/media or the C: drive.
// Only the media URL changes in memory; film, runtime and app behavior are intact.
if (process.env.FIREJAM_CAPTURE_MEDIA) {
  const { default: express } = await import('../../node_modules/express/index.js');
  const { CATALOG } = await import('../../server/src/catalog.ts');
  const media = express();
  media.use((_req, res, next) => { res.setHeader('Access-Control-Allow-Origin', '*'); next(); });
  media.use(express.static(process.env.FIREJAM_CAPTURE_MEDIA));
  await new Promise((resolve, reject) => media.listen(3001, '0.0.0.0', resolve).once('error', reject));
  const film = CATALOG.find(m => m.id === 'sintel');
  film.src = 'http://localhost:3001/sintel.mp4';
}
await import('../../server/src/index.ts');
