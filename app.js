var express = require('express');
var bodyParser = require('body-parser');
var path =require('path');
var app = express();
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
app.use(express.static(path.join(__dirname,'public')));
var users = [
	{   id:1
		first_name:'John',
		last_name:'Doe',
		email:'johndoe@gamil.com'

	},
	{	
		id:2
		first_name:'Jack',
		last_name:'Jill',
		email:'jack@gamil.com'

	},
	{
		id:3
		first_name:'Kerin',
		last_name:'kevin',
		email:'kevin@gamil.com'

	}
];
app.get('/',function(req,res){
	var title  = 'Customers';
	res.render('index',{
		'title':"Customers",
		'users':users
	});
});
app.listen(3000,function(){
	console.log("server started on port 3000..");
});