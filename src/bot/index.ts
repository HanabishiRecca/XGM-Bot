import './process';
import './client';
import './server';

if(global.gc) {
    setInterval(global.gc, 3600000);
    global.gc();
}
