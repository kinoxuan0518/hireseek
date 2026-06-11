(function(){
  var items=document.querySelectorAll('span,div,a,li');
  for(var i=0;i<items.length;i++){
    var t=items[i].innerText;
    if(t.indexOf('已获取简历')!=-1&&items[i].offsetHeight>0&&t.length<10){
      items[i].click();
      return 'clicked_resume_tab';
    }
  }
  return 'not_found';
})()