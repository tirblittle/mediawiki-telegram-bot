var TelegramBot = require( 'node-telegram-bot-api' );
var request = require( 'request' ).defaults( {
    jar: true
} );
var yaml = require( 'js-yaml' );
var fs = require( 'fs' );

var mode = 'fetching';
var targetTranslatableMessageTitle = null;
var apiUrl = 'https://translatewiki.net/w/api.php';

var debugLevel = 0;

var debug = function ( fromId, info ) {
    if ( !debugLevel ) {
        return;
    }

    tgBot.sendMessage( fromId, info );
};

var config;

// Get document, or throw exception on error
try {
    config = yaml.safeLoad( fs.readFileSync(
        __dirname + '/mediawiki-telegram-bot.config.yaml', 'utf8'
    ) );
} catch ( e ) {
    console.log( e );
}

var tgBot = new TelegramBot( config.token, { polling: true } );

// Matches /echo [whatever]
tgBot.onText( /\/echo (.+)/, function ( msg, match ) {
    var fromId = msg.from.id,
        resp = match[1];

    tgBot.sendMessage( fromId, resp );
} );

// Matches /untranslated [number]
tgBot.onText( /\/untranslated (\d+)/, function ( msg, match ) {
    var fromId = msg.from.id,
        translatableMessageNumber = match[1];

    request.post( {
        url: apiUrl,
        form: {
            action: 'query',
            format: 'json',
            prop: '',
            list: 'messagecollection',
            mcgroup: 'ext-0-wikimedia',
            mclanguage: 'he',
            mcfilter: '!optional|!ignored|!translated'
        } },
        function ( error, response, body ) {
            body = JSON.parse( body );

            var messageCollection = body.query.messagecollection;
            var targetTranslatableMessage =
                messageCollection[translatableMessageNumber];

            if ( !error && response.statusCode === 200 ) {
                tgBot.sendMessage( fromId, targetTranslatableMessage.definition );
            }

            mode = 'translation';
            targetTranslatableMessageTitle = targetTranslatableMessage.title;
        }
    );
} );

// Matches anything without a slash in the beginning
tgBot.onText( /([^\/].*)/, function ( msg, match ) {
    var fromId = msg.from.id,
        chatMessage = match[1];

    if ( mode !== 'translation' ||
        targetTranslatableMessageTitle === null
    ) {
        return;
    }

    debug( fromId, 'Got translation "' + chatMessage + '", getting token' );

    request.post( {
        url: apiUrl,
        form: {
            action: 'query',
            format: 'json',
            prop: '',
            meta: 'tokens',
            type: 'login'
        } },
        function ( error, response, body ) {
            debug( fromId, 'Token request over' );

            if ( error || response.statusCode !== 200 ) {
                tgBot.sendMessage( fromId, 'Error getting token' );
                tgBot.sendMessage( fromId, 'statusCode: ' + response.statusCode );
                tgBot.sendMessage( fromId, 'error: ' + error );

                return;
            }

            debug( fromId, 'Got MediaWiki login token: ' + body );

            body = JSON.parse( body );

            var mwLoginToken = body.query.tokens.logintoken;

            debug( fromId, 'Trying to authenticate' );
            request.post( {
                url: apiUrl,
                form: {
                    action: 'login',
                    format: 'json',
                    lgname: config.username,
                    lgpassword: config.password,
                    lgtoken: mwLoginToken
                } },
                function ( error, response, body ) {
                    debug( fromId, 'Log in request over' );

                    if ( error || response.statusCode !== 200 ) {
                        tgBot.sendMessage( fromId, 'Error logging in' );
                        tgBot.sendMessage( fromId, 'statusCode: ' + response.statusCode );
                        tgBot.sendMessage( fromId, 'error: ' + error );

                        return;
                    }

                    debug( fromId, 'Login token request response: ' + body );
                    debug( fromId, 'Logged in, how nice' );
                    debug( fromId, 'title: "' + targetTranslatableMessageTitle + '"' );
                    debug( fromId, 'Getting CSRF token' );

                    request.post( {
                        url: apiUrl,
                        form: {
                            action: 'query',
                            format: 'json',
                            meta: 'tokens',
                            type: 'csrf'
                        } },
                        function ( error, response, body ) {
                            debug( fromId, 'Edit token request over' );

                            if ( error || response.statusCode !== 200 ) {
                                tgBot.sendMessage( fromId, 'Error getting edit token' );
                                tgBot.sendMessage( fromId, 'statusCode: ' + response.statusCode );
                                tgBot.sendMessage( fromId, 'error: ' + error );

                                return;
                            }

                            body = JSON.parse( body );
                            var mwEditToken = body.query.tokens.csrftoken;
                            debug( fromId, 'Got edit token ' + mwEditToken );

                            request.post( {
                                url: apiUrl,
                                form: {
                                    action: 'edit',
                                    format: 'json',
                                    title: targetTranslatableMessageTitle,
                                    text: chatMessage,
                                    summary: 'Made with Telegram Bot',
                                    tags: 'TelegramBot',
                                    token: mwEditToken
                                } },
                                function ( error, response, body ) {
                                debug( fromId, 'Edit request over' );

                                if ( error || response.statusCode !== 200 ) {
                                    tgBot.sendMessage( fromId, 'Error editing' );
                                    tgBot.sendMessage( fromId, 'statusCode: ' + response.statusCode );
                                    tgBot.sendMessage( fromId, 'error: ' + error );

                                    return;
                                }

                                debug( fromId, 'Looks like it worked!' );

                                mode = 'fetching';
                                targetTranslatableMessageTitle = null;
                            } );
                        }
                    );
                }
            );
        }
    );
} );
