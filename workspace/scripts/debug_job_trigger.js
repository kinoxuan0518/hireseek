(function(){
  var iframe=document.querySelector('iframe');
  var doc=iframe.contentDocument||iframe.contentWindow.document;
  
  // Find all elements with "Agent 开发工程师" text that are visible
  var els=doc.querySelectorAll('[class*=job],[class*=Job]');
  var r=[];
  for(var i=0;i<els.length;i++){
    r.push(i+':'+els[i].tagName+'|visible='+(els[i].offsetHeight>0?'Y':'N')+'|txt='+els[i].innerText.substring(0,50));
  }
  
  // Also check any element that might be a dropdown trigger
  var triggers=doc.querySelectorAll('[class*=select],[class*=dropdown],[class*=drop],[class*=menu]');
  for(var i=0;i<triggers.length;i++){
    r.push('t'+i+':'+triggers[i].tagName+'|visible='+(triggers[i].offsetHeight>0?'Y':'N')+'|txt='+triggers[i].innerText.substring(0,40));
  }
  
  return String(r.join('||')||'none');
})()