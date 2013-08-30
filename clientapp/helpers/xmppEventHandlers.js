/*global XMPP, me, app, client*/
"use strict";

var crypto = XMPP.crypto;

var _ = require('underscore');
var Contact = require('../models/contact');
var Resource = require('../models/resource');
var Message = require('../models/message');


function logScroll() {
    window.scrollTo(0, document.body.scrollHeight);
}

function log(name, data) {
    var container = document.getElementById('log');
    var logEntry = document.createElement('div'),
        header = document.createElement('h2'),
        entry = document.createElement('p'),
        altEntry = document.createElement('p');

    header.textContent = name;
    logEntry.appendChild(header);

    if (data && data.toJSON) {
        var codeJSON = document.createElement('code');
        codeJSON.textContent = JSON.stringify(data.toJSON());

        altEntry.appendChild(codeJSON);
        logEntry.appendChild(altEntry);
        logEntry.appendChild(document.createElement('hr'));
    }

    var codeData = document.createElement('code');
    codeData.textContent = data;
    entry.appendChild(codeData);
    logEntry.appendChild(entry);

    if (container) {
        container.appendChild(logEntry);
        _.throttle(logScroll, 300);
    }
}


module.exports = function (client, app) {

    client.on('*', function (name, data) {
        log(name, data);
    });

    client.on('session:started', function (jid) {
        me.jid = jid;

        client.getRoster(function (err, resp) {
            resp = resp.toJSON();

            localStorage.rosterVersion = resp.roster.ver;

            _.each(resp.roster.items, function (item) {
                console.log(item);
                me.setContact(item, true);
            });

            client.updateCaps();
            client.sendPresence({
                caps: client.disco.caps
            });
            client.enableCarbons();
        });
    });

    client.on('roster:update', function (iq) {
        iq = iq.toJSON();
        var items = iq.roster.items;

        localStorage.rosterVersion = iq.roster.ver;

        _.each(items, function (item) {
            var contact = me.getContact(item.jid);

            if (item.subscription === 'remove') {
                if (contact) {
                    me.removeContact(contact);
                }
                return;
            }

            me.setContact(item, false);
        });
    });

    client.on('available', function (pres) {
        pres = pres.toJSON();
        var contact = me.getContact(pres.from);
        if (contact) {
            delete pres.id;
            pres.show = pres.show || '';
            pres.status = pres.status || '';
            pres.priority = pres.priority || 0;

            var resource = contact.resources.get(pres.from);
            if (resource) {
                resource.set(pres);
            } else {
                resource = new Resource(pres);
                resource.cid = pres.from;
                contact.resources.add(resource);
            }
        }
    });

    client.on('unavailable', function (pres) {
        pres = pres.toJSON();
        var contact = me.getContact(pres.from);
        if (contact) {
            var resource = contact.resources.get(pres.from);
            if (resource) {
                contact.resources.remove(resource);
            }

            if (contact.resources.length === 0) {
                contact.offlineStatus = pres.status;
            }
        }
    });

    client.on('avatar', function (info) {
        var contact = me.getContact(info.jid);
        if (contact) {
            var id = '';
            var type = 'image/png';
            if (info.avatars.length > 0) {
                id = info.avatars[0].id;
                type = info.avatars[0].type || 'image/png';
            }
            contact.setAvatar(id, type);
        }
    });

    client.on('chatState', function (info) {
        var contact = me.getContact(info.from);
        if (contact) {
            contact.chatState = info.chatState;
            if (info.chatState === 'gone') {
                contact.lockedResource = undefined;
            }
        }
    });

    client.on('chat', function (msg) {
        msg = msg.toJSON();
        var contact = me.getContact(msg.from, msg.to);
        if (contact && !msg.replace) {
            var message = new Message();
            message.cid = msg.id;
            message.set(msg);

            if (msg.archived) {
                msg.archived.forEach(function (archived) {
                    if (me.isMe(archived.by)) {
                        message.id = archived.id;
                    }
                });
            }

            contact.messages.add(message);
            if (!contact.lockedResource) {
                contact.lockedResource = msg.from;
            } else if (msg.from !== contact.lockedResource) {
                contact.lockedResource = undefined;
            }
        }
    });

    client.on('replace', function (msg) {
        msg = msg.toJSON();
        var contact = me.getContact(msg.from, msg.to);
        if (!contact) return;

        var id = msg.replace;
        var original = contact.messages.get(id);

        if (!original) return;

        original.correct(msg);
    });
    
    client.on('carbon:received', function (carbon) {
        if (!me.isMe(carbon.from)) return;

        var msg = carbon.carbonReceived.forwarded.message;
        var delay = carbon.carbonReceived.forwarded.delay;
        if (!delay.stamp) {
            delay.stamp = Date.now();
        }

        if (!msg._extensions.delay) {
            msg.delay = delay;
        }

        client.emit('message', msg);
    });

    client.on('carbon:sent', function (carbon) {
        if (!me.isMe(carbon.from)) return;

        var msg = carbon.carbonSent.forwarded.message;
        var delay = carbon.carbonSent.forwarded.delay;
        if (!delay.stamp) {
            delay.stamp = Date.now();
        }

        if (!msg._extensions.delay) {
            msg.delay = delay;
        }

        client.emit('message', msg);
    });
};
