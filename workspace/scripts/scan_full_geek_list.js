(function(){
  var items=document.querySelectorAll('.geek-item');
  var r=[];
  for(var i=0;i<items.length;i++){
    var txt=items[i].innerText;
    var lines=txt.split('\n');
    var name=lines[0];
    var hasResume=txt.indexOf('发送附件简历')!=-1;
    var hasPDF=txt.indexOf('.pdf')!=-1||txt.indexOf('简历')!=-1;
    var replied=txt.indexOf('可以')!=-1&&txt.indexOf('可以')>-1&&txt.length<30;
    r.push(i+':N:'+name+'|resume='+(hasResume?'Y':'N')+'|pdf='+(hasPDF?'Y':'N')+'|reply='+(replied?'Y':'N'));
  }
  return String(r.join('||'));
})()