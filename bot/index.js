'use strict';

import './process.js';
import './client.js';
import './server.js';

if(global.gc) {
    setInterval(global.gc, 3600000);
    global.gc();
}
