import './bot/process';
import './bot/client';
import './bot/server';

if(global.gc) {
    setInterval(global.gc, 3600000);
    global.gc();
}
