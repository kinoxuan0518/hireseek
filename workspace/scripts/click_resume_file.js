(function(){
  var all=document.querySelectorAll('a');
  for(var i=0;i<all.length;i++){
    var t=all[i].innerText;
    if(t.indexOf('附件简历')!=-1&&all[i].offsetHeight>0){
      all[i].click();
      return 'clicked_附件简历';
    }
  }
  return 'not_found';
})()