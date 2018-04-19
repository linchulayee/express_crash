var express = require('express');
var bodyParser = require('body-parser');
var path =require('path');
var app = express();
var cors = require('cors');
var cri = require('chrome-remote-interface');
var redis = require("redis");
var redisClient = redis.createClient();
var kue = require('kue');
var config = require('./config.js');
var dns = require('dns');
// var logger  = function(req,res,next){
// 	console.log("logging");
// 	next();
// }
// app.use(logger);
//body parser middle ware
//view Engine
app.set('view engine','ejs');
app.set('views',path.join(__dirname,'views'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended:false}));
//set static path

var harQueue = kue.createQueue({
    jobEvents: false,
    redis: {
        port: 6379,
        host: '127.0.0.1',
        db: 3
    }
});

app.use(express.static(path.join(__dirname,'public')));
const SimpleNodeLogger = require('simple-node-logger'),
    opts = {
        logFilePath:'project.log',
        timestampFormat:'YYYY-MM-DD HH:mm:ss.SSS'
    },
log = SimpleNodeLogger.createSimpleLogger( opts );

app.get('/',function(req,res){
	var title  = 'Customers';
	log.info('An informational message!');
	log.warn('A warning!');
	log.error('An error!');
	res.render('index',{
		'title':"Customers",
		'users':users
	});
});
var harQueueArray = [];
var harQueueLookup = {};
var harReq = {};
var CONCURRENCY = config.CONCURRENCY || 10;
app.get('/har', cors(), function(req, res, next) {

    var url = req.query.url || "";
    var priority = req.query.priority || 'normal';
    var id = req.query.id || undefined;

    console.log(new Date().toUTCString(), ' har:incoming ', url, priority, id);

    if (id && url != "") {
        var harJob = harQueue.create('har_requests', { id: id, url: url }).priority(priority).removeOnComplete( true ).save(function(err) {
            if (!err) {
                harQueueArray.push(id);
                harQueueLookup[id] = id;
                harReq[id] = { res: res, req: req };
                console.log(new Date().toUTCString(), ' har:job created ', url, priority, id);
            } else {
                console.log(new Date().toUTCString(), ' har:job creation failed ', url, priority, id, err.toString());
                res.status(500).json({ message: err.toString() });
            }
        });
    } else {
        res.status(500).json({ message: "url and id is required" });
    }
});

harQueue.process('har_requests', CONCURRENCY, function(job, done) {

    var id = job.data.id;
    var res = harReq[id].res;
    delete harReq[id];
    var index = harQueueArray.indexOf(id);
    harQueueArray.splice(index, 1);
    delete harQueueLookup[id];
    var tabManagerP;
    var resourcesToIgnore = [];
    var targetUrl = job.data.url;
    var protocolSec = targetUrl.split(":")[0];
    var noProtoSec = targetUrl.replace(/^https?\:\/\//i, "");
    var rootDomain = noProtoSec.substr(0, noProtoSec.indexOf('/'));
    var balancePart = "";
    if (rootDomain == "") {
        rootDomain = noProtoSec.substr(noProtoSec.indexOf('/') + 1).toLowerCase();
        targetUrl = protocolSec + "://" + rootDomain;
    } else {
        balancePart = noProtoSec.substr(noProtoSec.indexOf('/') + 1);
        targetUrl = protocolSec + "://" + rootDomain.toLowerCase() + "/" + balancePart;
    }

    console.log(new Date().toUTCString(), ' har:job process initiated ', targetUrl, id);


    function resolveARecord(rootDomain) {
        return new Promise(function(resolve, reject) {
            var timerId = setTimeout(function() {
                console.log(new Date().toUTCString(), ' har:dns timeout ', targetUrl, id);
                reject({ A: null, error: new Error("DNS timeout") });
            }, 5000);
            setTimeout(function() {
                dns.resolve(rootDomain + "", rrtype = 'A', function(err, addresses) {
                    console.log(err);
                    if (err) {
                        clearTimeout(timerId);
                        console.log(new Date().toUTCString(), ' har:dns ' + err.toString(), targetUrl, id);
                        reject({ A: null, error: err });
                    } else if (!err) {
                        clearTimeout(timerId);
                        console.log(new Date().toUTCString(), ' har:dns resolved ', targetUrl, id);
                        resolve({ A: addresses, error: null });
                    } else if (!addresses && !err) {
                        clearTimeout(timerId);
                        console.log(new Date().toUTCString(), ' har:dns unknown ', targetUrl, id);
                        reject({ A: null, error: new Error("DNS unknown") });
                    }
                });
            }, 0);
        })
    }


    resolveARecord(rootDomain).then(function(response) {

        console.log(new Date().toUTCString(), ' har:a records ', targetUrl, id, response);

        try {

            function getTabManager() {
                if (!tabManagerP) {
                    tabManagerP = new Promise((resolve, reject) => {
                        const emitter = cri({
                            tab: 'ws://localhost:9222/devtools/browser'
                        }, resolve);
                        emitter.once('disconnect', () => {
                            tabManagerP = null;
                            reject(new Error('Tabmanager disconnected'));
                        });
                        emitter.once('error', error => {
                            tabManagerP = null;
                            reject(error);
                        });
                    });
                }
                return tabManagerP;
            }

            function executeInTab(workFn) {
                return getTabManager().then(function(tabManager) {
                    return tabManager.Target.createTarget({
                        url: 'about:blank'
                    }).then(function(_ref) {
                        var targetId = _ref.targetId;
                        console.log(new Date().toUTCString(), ' har:open new browser target with id: ' + targetId, targetUrl, id);
                        return cri.List({
                            port: 9222
                        }).then(function(list) {
                            var url = list.find(function(target) {
                                return target.id === targetId;
                            }).webSocketDebuggerUrl;
                            return cri({
                                tab: url
                            });
                        }).then(function(devtools) {
                            return workFn(devtools);
                        }).then(function(result) {
                            console.log(new Date().toUTCString(), ' har:success ,browser target closing ', targetUrl, id);
                            return tabManager.Target.closeTarget({
                                targetId: targetId
                            }).then(function() {
                                return result;
                            });
                        }, function(error) {
                            console.log(new Date().toUTCString(), ' har:fail ,browser target closing ', targetUrl, id, error.toString());
                            return tabManager.Target.closeTarget({
                                targetId: targetId
                            }).then(function() {
                                throw error;
                            });
                        }).catch(function(reason) {
                            return reason;
                            // console.log(reason);
                            // res.status(404).json({ message: reason });
                            // done();
                        });
                    }).catch(function(reason) {
                        return reason;
                        // console.log(reason);
                        // res.status(404).json({ message: reason });
                        // done();
                    });
                }).catch(function(reason) {
                    return reason;
                    // console.log(reason);
                    // res.status(404).json({ message: reason });
                    // done();
                });
            }

            function doSomethingWithDevtools(client) {
                return new Promise((resolve, reject) => {

                    console.log(new Date().toUTCString(), ' har:open browser tab with given url ', targetUrl, id);

                    var chromeClient = new ChromeClient([targetUrl], {
                        fetchContent: false,
                        onLoadDelay: ONLOAD_DELAY
                    }, client);

                    var setId = setTimeout(function() {

                        reject('har:pageTimeout ' + targetUrl + ' at ' + new Date());

                        chromeClient.removeAllListeners(['end', 'error']);

                        // chromeClient.removeListener('pageEnd', pageEnd);

                        // chromeClient.removeListener('pageError', pageError);

                        // chromeClient.removeListener('end', end);

                        // chromeClient.removeListener('error', error);

                    }, SITE_TIME_OUT * 1000);

                    chromeClient.on('end', end);

                    chromeClient.on('error', error);

                    function end(har) {

                        console.log(new Date().toUTCString(), ' har:har generation success ', targetUrl, id);

                        var serverIp = ip.address();
                        var serverInfo = geoip.lookup(serverIp);

                        function timeNow() {
                            var now = new Date(),
                                ampm = 'am',
                                h = now.getHours(),
                                m = now.getMinutes(),
                                s = now.getSeconds();
                            if (h >= 12) {
                                if (h > 12) h -= 12;
                                ampm = 'pm';
                            }

                            if (m < 10) m = '0' + m;
                            if (s < 10) s = '0' + s;
                            return now.toLocaleDateString() + ' ' + h + ':' + m + ':' + s + ' ' + ampm;
                        }

                        har.testedDateAndTime = timeNow();
                        har.serverInfo = serverInfo;
                        clearTimeout(setId);
                        resolve(har);
                    }

                    function error(err) {
                        console.log(new Date().toUTCString(), ' har:har generation failed ', targetUrl, id, err.toString());
                        clearTimeout(setId);
                        reject(err);
                    }

                });
            }

            util.inherits(ChromeClient, events.EventEmitter);

            function ChromeClient(urls, options, chrome) {

                var self = this;
                var pages = [];
                const Network = chrome.Network;
                const Page = chrome.Page;
                const targetUrl = urls[0];

                var harPage = new HarPage(0, targetUrl, chrome, false);

                pages[0] = harPage;

                chrome.on('event', function(message) {
                    harPage.processMessage(message);
                });

                Page.loadEventFired((e) => {
                    setTimeout(function() {
                        chrome.close();

                        if (harPage.isFailed()) {
                            console.log(new Date().toUTCString(), ' har:chrome instance error ', targetUrl, id);
                            self.emit('error', new Error('Page failed'));
                        } else {
                            console.log(new Date().toUTCString(), ' har:chrome instance end ', targetUrl, id);
                            self.emit('end', createHar(pages));
                        }

                    }, ONLOAD_DELAY);
                });

                Promise.all([
                    Network.clearBrowserCache(),
                    Network.clearBrowserCookies(),
                    Network.setCacheDisabled({ cacheDisabled: true }),
                    Network.setUserAgentOverride({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36" }),
                    Network.enable(),
                    Page.enable()
                ]).then(() => {
                    return Page.navigate({ url: targetUrl });
                }).catch((err) => {
                    console.log(new Date().toUTCString(), ' har:chrome instance error ', targetUrl, id, err.toString());
                    self.emit('error', err);
                    chrome.close();
                });
            }

            executeInTab(devtools => {
                return doSomethingWithDevtools(devtools);
            }).then(result => {
                res.json(result);
                done();
            }).catch(function(reason) {
                console.log(new Date().toUTCString(), ' har:internal error ', targetUrl, id, reason.toString());
                res.status(404).json({ message: reason.toString() });
                done();
            });


        } catch (err) {
            console.log(new Date().toUTCString(), ' har:internal error ', targetUrl, id, err.toString());
            res.status(500).json({ message: err.toString() });
            done();
        }

    }).catch(function(error) {
        console.log(new Date().toUTCString(), ' har:a record not found ', targetUrl, id, error.toString());
        res.status(404).json({ message: error['error'].toString() });
        done();
    })

});

app.listen(3000,function(){
	console.log("server started on port 3000..");
});