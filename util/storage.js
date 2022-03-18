import fs from 'fs';
import { randomUUID } from 'crypto';

const
    { O_WRONLY, O_CREAT, O_EXCL, O_RDONLY } = fs.constants,
    WR_FLAGS = O_WRONLY | O_CREAT | O_EXCL,
    RD_BUFFER_SIZE = 4096,
    RD_DYN_SIZE = 64;

class DynamicBuffer {
    _buffer = Buffer.allocUnsafe(RD_DYN_SIZE);
    _length = 0;

    push = (byte) => {
        if((this._length + 1) > this._buffer.length) {
            const buffer = Buffer.allocUnsafe(this._buffer.length * 2);
            this._buffer.copy(buffer);
            this.buffer = buffer;
        }

        this._buffer[this._length++] = byte;
    };

    reset = () => void (this._length = 0);

    toString = () => this._buffer.toString('utf8', 0, this._length);

    get length() { return this._length; }
}

export const Load = (path) => {
    const
        map = new Map(),
        file = fs.openSync(path, O_RDONLY),
        buffer = Buffer.allocUnsafe(RD_BUFFER_SIZE),
        gen = new DynamicBuffer();

    const add = () => {
        if(gen.length < 1) return;
        const [k, v] = JSON.parse(`[${gen.toString()}]`);
        map.set(k, v);
        gen.reset();
    };

    let bytesRead = 0;

    while((bytesRead = fs.readSync(file, buffer)) > 0)
        for(const byte of buffer.subarray(0, bytesRead))
            (byte == 0x0A) ?
                add() : gen.push(byte);

    add();

    return map;
};

export const Save = (map, path) => {
    const
        tmp = `${path}.${randomUUID()}`,
        file = fs.openSync(tmp, WR_FLAGS);

    for(const entry of map) {
        const data = Buffer.from(JSON.stringify(entry), 'utf8');
        data[data.length - 1] = 0x0A;
        fs.writeSync(file, data, 1);
    }

    fs.fsyncSync(file);
    fs.closeSync(file);
    fs.renameSync(tmp, path);
};

export default { Load, Save };
