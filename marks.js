'use strict';

const
    marksChannel = '544569448649064458',
    platformsMessage = '544579657559834652',
    versionsMessage = '544582556264431617';

exports.list = [
    //PLATFORMS
    
    //battle.net
    { channel: marksChannel, message: platformsMessage, role: '544497908016480268', emoji: '543780416822181889' },
    
    //garena
    { channel: marksChannel, message: platformsMessage, role: '544571908923064320', emoji: '543780416725975053' },
    
    //iccup
    { channel: marksChannel, message: platformsMessage, role: '544571778627010560', emoji: '543780417245937667' },
    
    //irinabot
    { channel: marksChannel, message: platformsMessage, role: '549356271854288910', emoji: '549355406921695232' },
    
    //rubattle
    { channel: marksChannel, message: platformsMessage, role: '544572084974518272', emoji: '543780416822312960' },
    
    
    //VERSIONS
    
    //1.26
    { channel: marksChannel, message: versionsMessage, role: '544583914719543335', emoji: '544587939972120576' },
    
    //1.30
    { channel: marksChannel, message: versionsMessage, role: '544583994860240955', emoji: '544587950449754132' },
];