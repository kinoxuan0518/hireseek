(function(){
  var all=document.querySelectorAll('span,div,a');
  for(var i=0;i<all.length;i++){
    var t=all[i].innerText;
    if(t.indexOf('闫可菁_简历')!=-1&&all[i].offsetHeight>0){
      all[i].click();
      return 'clicked_file_'+all[i].tagName;
    }
  }
  return 'not_found';
})()