
"use strict";

/* VIDHWAAN NEET — LOGIN + COURSE ENGINE */

const DEFAULT_TOTAL_DAYS=365;
const DEFAULT_START_DATE="2026-08-30";
const DEFAULT_RELEASE_HOUR=6;
const DEFAULT_RELEASE_MINUTE=0;
const DEFAULT_TIMEZONE="Asia/Kolkata";
const CONFIG_URL="./data/app-config.json";
const DATA_DIRECTORY="./data/";
const DAY_PREFIX="day-";
const DAY_SUFFIX=".dat";
const CREDENTIALS_URL="./data/credentials.dat";
const NEET_DATA_KEY="__NEET_DATA_KEY__";
const SESSION_KEY="vidhwaan_neet_session";

const state={
totalDays:DEFAULT_TOTAL_DAYS,
startDate:DEFAULT_START_DATE,
releaseHour:DEFAULT_RELEASE_HOUR,
releaseMinute:DEFAULT_RELEASE_MINUTE,
timezone:DEFAULT_TIMEZONE,
releasedDay:0,
selectedDay:null,
lesson:null,
deferredInstallPrompt:null,
releaseTimer:null,
users:[]
};

const dom={};

document.addEventListener("DOMContentLoaded",initialize);

/* STARTUP */

async function initialize(){
cacheDOM();
showLogin();
try{
await loadConfiguration();
await loadCredentials();
if(await restoreSession()){
await startNEETApp();
}else{
setupLogin();
}
}catch(error){
console.error("VIDHWAAN NEET startup error:",error);
showLogin();
showLoginError("Unable to initialize login. Contact WhatsApp support.");
}
}

function cacheDOM(){
dom.loginView=document.getElementById("login-view");
dom.loginForm=document.getElementById("login-form");
dom.loginUsername=document.getElementById("login-username");
dom.loginPassword=document.getElementById("login-password");
dom.loginError=document.getElementById("login-error");
dom.loginButton=document.getElementById("login-button");
dom.mainContent=document.getElementById("main-content");
dom.daysView=document.getElementById("days-view");
dom.lessonView=document.getElementById("lesson-view");
dom.dayGrid=document.getElementById("day-grid");
dom.lessonContainer=document.getElementById("lesson-container");
dom.loadingState=document.getElementById("loading-state");
dom.errorState=document.getElementById("error-state");
dom.errorMessage=document.getElementById("error-message");
dom.retryButton=document.getElementById("retry-button");
dom.releaseStatusText=document.getElementById("release-status-text");
dom.todayBadge=document.getElementById("today-badge");
dom.releasedDaysCount=document.getElementById("released-days-count");
dom.brandHome=document.getElementById("brand-home");
dom.backButton=document.getElementById("back-button");
dom.lessonDayBadge=document.getElementById("lesson-day-badge");
dom.installButton=document.getElementById("install-button");
}

function showLogin(){
if(dom.loginView)dom.loginView.hidden=false;
if(dom.mainContent)dom.mainContent.hidden=true;
}

function showAuthenticatedApp(){
if(dom.loginView)dom.loginView.hidden=true;
if(dom.mainContent)dom.mainContent.hidden=false;
}

function showLoginError(message){
if(!dom.loginError)return;
dom.loginError.textContent=message;
dom.loginError.hidden=false;
}

function hideLoginError(){
if(dom.loginError)dom.loginError.hidden=true;
}

/* CONFIGURATION */

async function loadConfiguration(){
try{
const response=await fetch(CONFIG_URL+"?v="+Date.now(),{cache:"no-store"});
if(!response.ok)throw Error("Configuration HTTP "+response.status);
const config=await response.json();
state.totalDays=safeInteger(config.totalDays,365,1,365);
state.startDate=firstValid(config.courseStartDate,config.releaseStartDate,config.programStartDateIST,DEFAULT_START_DATE);
state.releaseHour=safeInteger(config.dailyActivationHourIST??config.publishHour,6,0,23);
state.releaseMinute=safeInteger(config.publishMinute,0,0,59);
state.timezone=firstValid(config.timezone,DEFAULT_TIMEZONE);
}catch(error){
console.warn("Using default course configuration",error);
}
}

function safeInteger(value,fallback,min,max){
const number=Number(value);
return Number.isInteger(number)&&number>=min&&number<=max?number:fallback;
}

function firstValid(...values){
for(const value of values){
if(value!==null&&value!==undefined&&String(value).trim()!==""){
return String(value).trim();
}
}
return "";
}

/* ENCRYPTED DATA */

async function loadCredentials(){
const response=await fetch(CREDENTIALS_URL+"?v="+Date.now(),{cache:"no-store"});
if(!response.ok)throw Error("Credentials file HTTP "+response.status);
const encrypted=await response.arrayBuffer();
const credentials=await decryptLessonData(encrypted);
if(!credentials||!Array.isArray(credentials.users)){
throw Error("Invalid credentials data");
}
state.users=credentials.users;
}

/* HEX KEY DECODING — CORRECTED */

function decodeHexKey(hexKey){
if(typeof hexKey!=="string"||!/^[0-9a-fA-F]{64}$/.test(hexKey)){
throw Error("NEET_DATA_KEY must contain exactly 64 hexadecimal characters");
}

const keyBytes=new Uint8Array(32);

for(let i=0;i<32;i++){
keyBytes[i]=parseInt(hexKey.slice(i*2,i*2+2),16);
}

if(keyBytes.length!==32){
throw Error("AES key must be exactly 32 bytes");
}

return keyBytes;
}

/* AES-256-GCM + GZIP DECRYPTION */

async function decryptLessonData(encryptedData){
if(typeof NEET_DATA_KEY!=="string"||!NEET_DATA_KEY){
throw Error("Decryption key unavailable");
}

let keyBytes;

try{
keyBytes=decodeHexKey(NEET_DATA_KEY);
}catch(error){
console.error("NEET key decoding failed:",error);
throw Error("Invalid hexadecimal decryption key");
}

const data=new Uint8Array(encryptedData);
const ivLength=12;
const tagLength=16;

if(data.length<=ivLength+tagLength){
throw Error("Encrypted data incomplete");
}

const iv=data.slice(0,ivLength);
const tag=data.slice(ivLength,ivLength+tagLength);
const ciphertext=data.slice(ivLength+tagLength);

const combined=new Uint8Array(ciphertext.length+tag.length);
combined.set(ciphertext);
combined.set(tag,ciphertext.length);

const cryptoKey=await crypto.subtle.importKey(
"raw",
keyBytes,
{name:"AES-GCM"},
false,
["decrypt"]
);

const compressed=await crypto.subtle.decrypt(
{name:"AES-GCM",iv,tagLength:128},
cryptoKey,
combined
);

if(typeof DecompressionStream==="undefined"){
throw Error("GZIP unsupported");
}

const stream=new Blob([compressed]).stream().pipeThrough(
new DecompressionStream("gzip")
);

const decompressed=await new Response(stream).arrayBuffer();
const json=new TextDecoder("utf-8",{fatal:true}).decode(decompressed);

return JSON.parse(json);
}

/* LOGIN */

function setupLogin(){
if(!dom.loginForm)return;
dom.loginForm.addEventListener("submit",handleLogin);
}

async function handleLogin(event){
event.preventDefault();
hideLoginError();

const username=dom.loginUsername.value.trim();
const password=dom.loginPassword.value;

if(!username||!password){
showLoginError("Enter your username and password.");
return;
}

dom.loginButton.disabled=true;
dom.loginButton.textContent="Verifying...";

try{
const user=state.users.find(item=>
String(item.username||"").trim().toLowerCase()===username.toLowerCase()
);

if(!user||user.active===false||String(user.password)!==password){
dom.loginPassword.value="";
showLoginError("Invalid username or password.");
return;
}

sessionStorage.setItem(SESSION_KEY,username);
showAuthenticatedApp();
await startNEETApp();

}catch(error){
console.error("Login error:",error);
showLoginError("Login failed. Please contact WhatsApp support.");
}finally{
dom.loginButton.disabled=false;
dom.loginButton.textContent="Login";
}
}

async function restoreSession(){
const username=sessionStorage.getItem(SESSION_KEY);

if(!username)return false;

const valid=state.users.some(user=>
String(user.username||"").trim().toLowerCase()===username.toLowerCase()&&user.active!==false
);

if(!valid){
sessionStorage.removeItem(SESSION_KEY);
return false;
}

return true;
}

/* COURSE INITIALIZATION */

async function startNEETApp(){
showAuthenticatedApp();
hideError();
hideLoading();

state.releasedDay=calculateReleasedDay();

renderDayGrid();
updateHomeStatus();
showDays();

setupCourseEvents();
setupInstallPrompt();
registerServiceWorker();
scheduleReleaseRefresh();
}

function setupCourseEvents(){
if(dom.brandHome)dom.brandHome.addEventListener("click",showDays);
if(dom.backButton)dom.backButton.addEventListener("click",showDays);
if(dom.retryButton)dom.retryButton.addEventListener("click",retrySelectedDay);
}

/* IST RELEASE */

function getISTParts(){
const parts=new Intl.DateTimeFormat("en-CA",{
timeZone:DEFAULT_TIMEZONE,
year:"numeric",
month:"2-digit",
day:"2-digit",
hour:"2-digit",
minute:"2-digit",
second:"2-digit",
hourCycle:"h23"
}).formatToParts(new Date());

const values={};

parts.forEach(part=>{
if(part.type!=="literal")values[part.type]=part.value;
});

return{
year:Number(values.year),
month:Number(values.month),
day:Number(values.day),
hour:Number(values.hour),
minute:Number(values.minute),
second:Number(values.second)
};
}

function getISTDateString(){
const now=getISTParts();

return[
String(now.year).padStart(4,"0"),
String(now.month).padStart(2,"0"),
String(now.day).padStart(2,"0")
].join("-");
}

function parseDateOnly(value){
const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));

if(!match)throw Error("Invalid course date");

return new Date(Date.UTC(
Number(match[1]),
Number(match[2])-1,
Number(match[3])
));
}

function daysBetween(start,end){
return Math.floor((parseDateOnly(end)-parseDateOnly(start))/86400000);
}

function calculateReleasedDay(){
const difference=daysBetween(state.startDate,getISTDateString());

if(difference<0)return 0;

const now=getISTParts();

const releaseReached=now.hour>state.releaseHour||
(now.hour===state.releaseHour&&now.minute>=state.releaseMinute);

return Math.max(
0,
Math.min(difference+(releaseReached?1:0),state.totalDays)
);
}

/* DAY GRID */

function renderDayGrid(){
if(!dom.dayGrid)return;

state.releasedDay=calculateReleasedDay();

const fragment=document.createDocumentFragment();

for(let day=1;day<=state.totalDays;day++){
const button=document.createElement("button");

button.type="button";
button.className="day-button";
button.dataset.day=String(day);
button.textContent=String(day);

if(day<=state.releasedDay){
button.classList.add("available");
button.setAttribute("aria-label","Open Day "+day);
button.addEventListener("click",()=>openDay(day));
}else{
button.classList.add("locked");
button.disabled=true;
button.setAttribute("aria-label","Day "+day+" locked");
}

if(day===state.releasedDay)button.classList.add("current");

fragment.appendChild(button);
}

dom.dayGrid.replaceChildren(fragment);
updateDaysCount();
}

function updateDaysCount(){
if(dom.releasedDaysCount){
dom.releasedDaysCount.textContent=
state.releasedDay+" / "+state.totalDays+" available";
}
}

function updateHomeStatus(){
state.releasedDay=calculateReleasedDay();
updateDaysCount();

if(dom.todayBadge){
dom.todayBadge.textContent=state.releasedDay?
"Day "+state.releasedDay+" available":
"Course starts at 6:00 AM IST";
}

if(dom.releaseStatusText){
dom.releaseStatusText.textContent=state.releasedDay===0?
"Day 1 unlocks at 6:00 AM IST":
state.releasedDay>=state.totalDays?
"All 365 days available":
"Day "+state.releasedDay+" available";
}
}

/* LOAD DAY */

async function openDay(dayNumber){
state.releasedDay=calculateReleasedDay();

if(!Number.isInteger(dayNumber)||dayNumber<1||dayNumber>state.totalDays)return;

if(dayNumber>state.releasedDay){
renderDayGrid();
showDays();
return;
}

state.selectedDay=dayNumber;

try{
hideError();
showLoading();

const lesson=await loadDayJSON(dayNumber);

validateLesson(lesson,dayNumber);

state.lesson=lesson;

renderLesson(lesson,dayNumber);

hideLoading();
showLesson();

window.scrollTo({top:0,behavior:"smooth"});

}catch(error){
console.error("Day "+dayNumber+" failed:",error);
hideLoading();
showError("Unable to load Day "+dayNumber+". Please try again.");
}
}

async function loadDayJSON(dayNumber){
const filename=DAY_PREFIX+String(dayNumber).padStart(3,"0")+DAY_SUFFIX;

const response=await fetch(DATA_DIRECTORY+filename+"?v="+Date.now(),{
cache:"no-store",
headers:{"Accept":"application/octet-stream"}
});

if(!response.ok)throw Error("Lesson HTTP "+response.status);

return decryptLessonData(await response.arrayBuffer());
}

function validateLesson(lesson,day){
if(!lesson||typeof lesson!=="object"||Array.isArray(lesson)){
throw Error("Invalid lesson");
}

if(lesson.day!==undefined&&Number(lesson.day)!==day){
throw Error("Lesson day mismatch");
}
}

/* LESSON RENDERING */

function renderLesson(lesson,day){
const title=firstValid(lesson.title,"Day "+day);
const subject=firstValid(lesson.subject,"");
const unit=firstValid(lesson.unit,"");
const chapter=firstValid(lesson.chapter,"");
const sections=Array.isArray(lesson.sections)?lesson.sections:[];
const mcqs=Array.isArray(lesson.mcqs)?lesson.mcqs:[];
const focus=toArray(lesson.neetFocus);
const outcomes=toArray(lesson.learningOutcome);

if(dom.lessonDayBadge)dom.lessonDayBadge.textContent="DAY "+day;

dom.lessonContainer.innerHTML=
'<article class="neet-lesson">'+
'<header class="lesson-hero"><span class="lesson-day-label">DAY '+day+'</span>'+
'<h1 class="lesson-title">'+escapeHTML(title)+'</h1>'+
(subject||unit||chapter?'<p class="lesson-subtitle">'+renderMeta(subject,unit,chapter)+'</p>':'')+
'</header>'+
(focus.length?'<section class="content-section"><div class="content-card"><h2>NEET Focus</h2>'+renderList(focus)+'</div></section>':'')+
(outcomes.length?'<section class="content-section"><div class="content-card"><h2>What You Will Learn</h2>'+renderList(outcomes)+'</div></section>':'')+
(sections.length?'<section class="content-section"><h2>Concepts</h2><div class="topics-list">'+sections.map(renderSection).join("")+'</div></section>':'')+
(mcqs.length?'<section class="mcqs-section"><h2>NEET Practice — MCQs</h2><div class="mcqs-list">'+mcqs.map(renderMCQ).join("")+'</div></section>':'')+
'</article>';

attachMCQEvents();
}

function renderMeta(subject,unit,chapter){
return[subject,unit,chapter].filter(Boolean).map(escapeHTML).join(" • ");
}

function renderSection(section,index){
if(!section||typeof section!=="object")return "";

const heading=firstValid(section.heading,section.topic,"Concept "+(index+1));
const content=section.content??"";
const subsections=Array.isArray(section.subsections)?section.subsections:[];
const points=toArray(section.keyPoints);
const tips=toArray(section.neetTips);

return'<article class="topic-card"><div class="topic-header"><h3>'+escapeHTML(heading)+'</h3></div>'+
'<div class="topic-content">'+(content?'<p>'+renderRichText(content)+'</p>':'')+
(subsections.length?'<div class="concepts-list">'+subsections.map(renderSubsection).join("")+'</div>':'')+
(points.length?'<div class="key-points"><h4>Key Points</h4>'+renderList(points)+'</div>':'')+
(tips.length?'<div class="neet-tips"><h4>NEET Tips</h4>'+renderList(tips)+'</div>':'')+
'</div></article>';
}

function renderSubsection(item){
if(!item||typeof item!=="object")return "";

return'<div class="concept-card"><h3>'+escapeHTML(firstValid(item.heading,""))+'</h3><p>'+renderRichText(item.content??"")+'</p></div>';
}

function renderMCQ(mcq,index){
if(!mcq||typeof mcq!=="object")return "";

const options=Array.isArray(mcq.options)?mcq.options:[];

return'<article class="mcq-card" data-mcq-index="'+index+'" data-correct-answer="'+escapeHTML(normalizeAnswer(mcq.answer))+'">'+
'<div class="mcq-header"><span>Question '+(index+1)+'</span><button type="button" class="mcq-share-button">Share</button></div>'+
'<div class="mcq-body"><h3 class="mcq-question">'+renderRichText(mcq.question??"")+'</h3>'+
'<div class="mcq-options">'+options.map(renderOption).join("")+'</div>'+
'<div class="mcq-result" hidden></div>'+
'<div class="mcq-explanation" hidden><h4>Explanation</h4><p>'+renderRichText(mcq.explanation??"Explanation not provided.")+'</p></div>'+
'</div></article>';
}

function renderOption(option,index){
const letter=String.fromCharCode(65+index);

return'<button type="button" class="mcq-option" data-option="'+letter+'"><span class="option-letter">'+letter+'</span><span class="option-text">'+renderRichText(option)+'</span></button>';
}

function attachMCQEvents(){
dom.lessonContainer.querySelectorAll(".mcq-card").forEach(card=>{
card.querySelectorAll(".mcq-option").forEach(option=>{
option.addEventListener("click",()=>answerMCQ(card,option));
});

const share=card.querySelector(".mcq-share-button");

if(share)share.addEventListener("click",()=>shareMCQ(card));
});
}

function answerMCQ(card,selected){
if(card.dataset.answered==="true")return;

const correct=normalizeAnswer(card.dataset.correctAnswer);
const answer=normalizeAnswer(selected.dataset.option);

if(!/^[A-D]$/.test(correct))return;

card.dataset.answered="true";

const options=card.querySelectorAll(".mcq-option");

options.forEach(option=>{
option.disabled=true;

if(normalizeAnswer(option.dataset.option)===correct){
option.classList.add("correct","is-correct");
}
});

const isCorrect=answer===correct;

if(!isCorrect)selected.classList.add("wrong","is-wrong");

const result=card.querySelector(".mcq-result");

result.hidden=false;
result.className="mcq-result "+(isCorrect?"correct":"wrong");
result.textContent=isCorrect?"✓ Correct!":"✕ Incorrect. Correct answer: "+correct;

card.querySelector(".mcq-explanation").hidden=false;
}

function normalizeAnswer(value){
if(value===null||value===undefined)return "";

if(typeof value==="number"&&value>=0&&value<=3){
return String.fromCharCode(65+value);
}

const text=String(value).trim().toUpperCase();

if(/^[A-D]$/.test(text))return text;

if(/^[0-3]$/.test(text)){
return String.fromCharCode(65+Number(text));
}

const match=text.match(/\bOPTION\s+([A-D])\b/)||
text.match(/\bANSWER\s*[:\-]?\s*([A-D])\b/);

return match?match[1]:text;
}

/* MCQ SHARE */

async function shareMCQ(card){
const question=card.querySelector(".mcq-question").textContent.trim();

const options=Array.from(card.querySelectorAll(".option-text"))
.map(x=>x.textContent.trim());

const text="VIDHWAAN NEET\n\n"+question+"\n\n"+
options.map((x,i)=>String.fromCharCode(65+i)+". "+x).join("\n")+
"\n\nvidhwaan.com";

try{
if(navigator.share){
await navigator.share({title:"VIDHWAAN NEET MCQ",text});
}else{
await navigator.clipboard.writeText(text);
showToast("MCQ copied to clipboard.");
}
}catch(error){
if(error.name!=="AbortError"){
console.warn("MCQ share failed",error);
}
}
}

/* HELPERS */

function toArray(value){
return Array.isArray(value)?
value.filter(x=>x!==null&&x!==undefined&&String(x).trim()!==""):[];
}

function renderList(items){
return'<ul class="neet-content-list">'+
items.map(x=>'<li>'+renderRichText(x)+'</li>').join("")+
'</ul>';
}

function renderRichText(value){
return escapeHTML(value)
.replace(/\r?\n/g,"<br>")
.replace(/\*([^*]+)\*/g,"<em>$1</em>");
}

function escapeHTML(value){
return String(value??"")
.replaceAll("&","&amp;")
.replaceAll("<","&lt;")
.replaceAll(">","&gt;")
.replaceAll('"',"&quot;")
.replaceAll("'","&#039;");
}

function showToast(message){
let toast=document.getElementById("neet-toast");

if(!toast){
toast=document.createElement("div");
toast.id="neet-toast";
toast.setAttribute("role","status");

Object.assign(toast.style,{
position:"fixed",
left:"50%",
bottom:"24px",
transform:"translateX(-50%)",
zIndex:"3000",
padding:"12px 16px",
borderRadius:"12px",
background:"#17191c",
color:"#fff",
fontSize:"14px",
fontWeight:"700"
});

document.body.appendChild(toast);
}

toast.textContent=message;
toast.hidden=false;

clearTimeout(toast.timer);
toast.timer=setTimeout(()=>toast.hidden=true,2500);
}

/* NAVIGATION */

function showDays(){
hideLoading();
hideError();

if(dom.lessonView)dom.lessonView.hidden=true;
if(dom.daysView)dom.daysView.hidden=false;

state.selectedDay=null;
state.lesson=null;

updateHomeStatus();
renderDayGrid();

window.scrollTo({top:0,behavior:"smooth"});
}

function showLesson(){
hideError();

if(dom.daysView)dom.daysView.hidden=true;
if(dom.lessonView)dom.lessonView.hidden=false;
}

function showLoading(){
if(dom.loadingState)dom.loadingState.hidden=false;
}

function hideLoading(){
if(dom.loadingState)dom.loadingState.hidden=true;
}

function showError(message){
if(dom.errorMessage)dom.errorMessage.textContent=message;
if(dom.errorState)dom.errorState.hidden=false;
}

function hideError(){
if(dom.errorState)dom.errorState.hidden=true;
}

async function retrySelectedDay(){
hideError();

if(Number.isInteger(state.selectedDay)){
await openDay(state.selectedDay);
}else{
await startNEETApp();
}
}

/* DAILY RELEASE REFRESH */

function scheduleReleaseRefresh(){
if(state.releaseTimer)clearInterval(state.releaseTimer);

state.releaseTimer=setInterval(()=>{
const previous=state.releasedDay;
const current=calculateReleasedDay();

if(current!==previous){
state.releasedDay=current;

if(!dom.lessonView||dom.lessonView.hidden){
renderDayGrid();
updateHomeStatus();
}
}
},30000);
}

/* PWA INSTALL */

function setupInstallPrompt(){
window.addEventListener("beforeinstallprompt",event=>{
event.preventDefault();

state.deferredInstallPrompt=event;

if(dom.installButton)dom.installButton.hidden=false;
});

window.addEventListener("appinstalled",()=>{
state.deferredInstallPrompt=null;

if(dom.installButton)dom.installButton.hidden=true;
});

if(dom.installButton){
dom.installButton.addEventListener("click",installApplication);
}
}

async function installApplication(){
if(!state.deferredInstallPrompt)return;

state.deferredInstallPrompt.prompt();

try{
await state.deferredInstallPrompt.userChoice;
}catch(error){
console.warn("Install prompt failed",error);
}

state.deferredInstallPrompt=null;

if(dom.installButton)dom.installButton.hidden=true;
}

/* SERVICE WORKER */

function registerServiceWorker(){
if(!("serviceWorker"in navigator))return;

window.addEventListener("load",async()=>{
try{
const registration=await navigator.serviceWorker.register("./sw.js",{scope:"./"});

console.log("VIDHWAAN NEET service worker registered:",registration.scope);

await registration.update();

}catch(error){
console.warn("Service worker registration failed",error);
}
});
}
