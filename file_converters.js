const { spawn } = require('node:child_process');
//const _ffmpeg = require('ffmpeg');
// fuck sharp, ffmpeg is the GOAT
const {Readable} = require('node:stream');
const csv = require('csv-parser')


function ffmpegPromiseHandler(ffmpeg, buffer, resolve, reject) {
    const chunks = [];

    ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));
    ffmpeg.on('error', (err) => reject(err));

    ffmpeg.on('close', (code) => {
        if (code === 0) {
            resolve(Buffer.concat(chunks));
        } else {
            reject(new Error(`FFmpeg exited with code ${code}`));
        }
    });

    // Feed the PGM buffer into FFmpeg stdin
    ffmpeg.stdin.write(buffer);
    ffmpeg.stdin.end();
}

const converters = {
    PGMtoPNG(buffer) {
        return new Promise((resolve, reject) => {
            // Pipe input from stdin (pipe:0) and output PNG format to stdout (pipe:1)
            const ffmpeg = spawn('ffmpeg', [
                '-i', 'pipe:0',          // Input from stdin
                '-f', 'image2pipe',      // Input/output format stream type
                '-vcodec', 'png',        // Force PNG output codec
                'pipe:1'                 // Output to stdout
            ]);

            ffmpegPromiseHandler(ffmpeg, buffer, resolve, reject);
        });
    },

    PNGtoPreview(buffer,{ratio, size}) {
        return new Promise((resolve, reject) => {
            if (!ratio || !size) {
                reject(new Error('invalid preview size'));
            }

            // Pipe input from stdin (pipe:0) and output PNG format to stdout (pipe:1)
            const ffmpeg = spawn('ffmpeg', [
                '-i', 'pipe:0',                                                  // Input from stdin
                '-f', 'image2pipe',                                              // Input/output format stream type
                '-vf', `crop=${ratio}*iw:${ratio}*ih:(iw-ow)/2:(ih-oh)/2,scale=${size}:-1`,  // crop middle portion
                'pipe:1'                                                         // Output to stdout
            ]);

            ffmpegPromiseHandler(ffmpeg, buffer, resolve, reject);
        });
    },

    CSVtoObjectArray(buffer) {
        return new Promise((resolve, reject) => {
            let headers = [];
            const data = [];

            Readable.from(buffer)
                .pipe(csv({
                    mapValues: ({ value }) => {
                        if (value === 'True') return true;
                        if (value === 'False') return false;
                        if (value !== '' && !isNaN(value)) return Number(value);
                        return value;
                    }
                }))
                .on('headers', (headerList) => {
                    headers = headerList;
                })
                .on('data', (row) => {
                    // Map object values into a fixed-length array matching the exact header order
                    const rowArray = headers.map((header) => row[header]);
                    data.push(rowArray);
                })
                .on('end', () => {
                    // Create an index lookup map: { point_id: 0, time: 1, x: 2, ... }
                    const indexMap = Object.fromEntries(
                        headers.map((header, index) => [header, index])
                    );

                    resolve({
                        headers,
                        indexMap,
                        data
                    });
                })
                .on('error', (err) => reject(err));
        });
    }
}

module.exports = converters;