import undici from 'undici';
import lodash from 'lodash';
import { generateRandomIP, randomUserAgent } from './utils.js';
import {copyHeaders} from './copyHeaders.js';
import {compressImg} from './compress.js';
import {redirect} from './redirect.js';
import {shouldCompress} from './shouldCompress.js';

const viaHeaders = [
    '1.1 example-proxy-service.com (ExampleProxy/1.0)',
    '1.0 another-proxy.net (Proxy/2.0)',
    '1.1 different-proxy-system.org (DifferentProxy/3.1)',
    '1.1 some-proxy.com (GenericProxy/4.0)',
];

function randomVia() {
    const index = Math.floor(Math.random() * viaHeaders.length);
    return viaHeaders[index];
}

export async function processRequest(request, reply) {
    const { url, jpeg, bw, l } = request.query;

    if (!url) {
        const ipAddress = generateRandomIP();
        const ua = randomUserAgent();
        const hdrs = {
            ...lodash.pick(request.headers, ['cookie', 'dnt', 'referer']),
            'x-forwarded-for': ipAddress,
            'user-agent': ua,
            'via': randomVia(),
        };

        Object.entries(hdrs).forEach(([key, value]) => reply.header(key, value));
        
        return reply.send('1we23');
    }

    const urlList = Array.isArray(url) ? url.join('&url=') : url;
    const cleanUrl = urlList.replace(/http:\/\/1\.1\.\d\.\d\/bmi\/(https?:\/\/)?/i, 'http://');

    request.params.url = cleanUrl;
    request.params.webp = !jpeg;
    request.params.grayscale = bw !== '0';
    request.params.quality = parseInt(l, 10) || 40;

    const randomIP = generateRandomIP();
    const userAgent = randomUserAgent();

    
    try {
        const origin = await undici.request(request.params.url, {
            headers: {
                ...lodash.pick(request.headers, ['cookie', 'dnt', 'referer']),
                'user-agent': userAgent,
                'x-forwarded-for': randomIP,
                'via': randomVia(),
            },
            timeout: 10000,
            maxRedirections: 4
        });

        return _onRequestResponse(origin, request, reply);
    } catch (err) {
        return _onRequestError(request, reply, err);
    }
}

function _onRequestError(request, reply, err) {
    if (err.code === 'ERR_INVALID_URL') {
        return reply.status(400).send('Invalid URL');
    }

    redirect(request, reply);
    console.error(err);
}

function _onRequestResponse(origin, request, reply) {
    if (origin.statusCode >= 400 || (origin.statusCode >= 300 && origin.headers.location)) {
        return redirect(request, reply);
    }

    copyHeaders(origin, reply);
    reply.header('content-encoding', 'identity');
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
    reply.header('Cross-Origin-Embedder-Policy', 'unsafe-none');

    request.params.originType = origin.headers['content-type'] || '';
    request.params.originSize = parseInt(origin.headers['content-length'] || '0', 10);

    origin.body.on('error', () => request.socket.destroy());

    if (shouldCompress(request)) {
        return compressImg(request, reply, origin.body);
    } else {
        reply.header('x-proxy-bypass', 1);

        ['accept-ranges', 'content-type', 'content-length', 'content-range'].forEach(headerName => {
            if (headerName in origin.headers) {
                reply.header(headerName, origin.headers[headerName]);
            }
        });

        return origin.body.pipe(reply.raw);
    }
}
