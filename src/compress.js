import sharp from 'sharp';
import { redirect } from './redirect.js';

const sharpStream = () => sharp({ animated: !process.env.NO_ANIMATE, unlimited: true });

export async function compress(request, reply, input) {
  const format = request.params.webp ? 'webp' : 'jpeg';

  input.pipe(
    sharpStream()
      .grayscale(request.params.grayscale)
      .toFormat(format, {
        quality: request.params.quality,
        progressive: true,
        optimizeScans: true,
      })
      .toBuffer((err, output, info) => _sendResponse(err, output, info, format, request, reply))
  );
}

function _sendResponse(err, output, info, format, request, reply) {
  if (err || !info) {
    return redirect(request, reply);
  }

  reply.header('content-type', 'image/' + format);
  reply.header('content-length', info.size);
  reply.header('x-original-size', request.params.originSize);
  reply.header('x-bytes-saved', request.params.originSize - info.size);
  
  reply.status(200).send(output);
}
