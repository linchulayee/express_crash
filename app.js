var express = require('express');
var bodyParser = require('body-parser');
var path =require('path');
var app = express();
var cors = require('cors');
var cri = require('chrome-remote-interface');
var redis = require("redis");
var redisClient = redis.createClient();
var kue = require('kue');
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
        port: 8000,
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

app.listen(3000,function(){
	console.log("server started on port 3000..");
});