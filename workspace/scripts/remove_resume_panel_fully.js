(function(){
  var rc=document.querySelector('.resume-content');
  var fi=document.querySelector('.attachment-iframe');
  if(rc){rc.remove();}
  if(fi){fi.remove();}
  return 'removed_rc='+(rc?'Y':'N')+' fi='+(fi?'Y':'N');
})()