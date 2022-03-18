'use strict';

const
    marksChannel = '544569448649064458',
    platformsMessage = '544579657559834652',
    versionsMessage = '544582556264431617';

export default {
    server: '543458159818440705',

    role: {
        staff: '543458613474099214',
        team: '751140057141870744',
        user: '543458703807086602',
        readonly: '544598116129832961',
        twilight: '572031693947666478',
    },

    commands: [
        '829379545554616341',
        '874983640000528435',
    ],

    marks: [
        //PLATFORMS

        //battle.net
        { channel: marksChannel, message: platformsMessage, role: '544497908016480268', emoji: '543780416822181889' },

        //iccup
        { channel: marksChannel, message: platformsMessage, role: '544571778627010560', emoji: '543780417245937667' },

        //irinabot
        { channel: marksChannel, message: platformsMessage, role: '549356271854288910', emoji: '549355406921695232' },

        //rubattle
        { channel: marksChannel, message: platformsMessage, role: '544572084974518272', emoji: '543780416822312960' },

        //dota 2
        { channel: marksChannel, message: platformsMessage, role: '614809606572736512', emoji: '614809363621740555' },

        //VERSIONS

        //1.26
        { channel: marksChannel, message: versionsMessage, role: '544583914719543335', emoji: '544587939972120576' },

        //1.30
        { channel: marksChannel, message: versionsMessage, role: '544583994860240955', emoji: '544587950449754132' },

        //reforged
        { channel: marksChannel, message: versionsMessage, role: '659464540513370128', emoji: '659463638507192381' },
    ],
};
