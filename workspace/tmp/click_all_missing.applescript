tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument||iframe.contentWindow.document; var opts=doc.querySelectorAll('.option'); var items=['26年毕业','1年以内','1-3年','本科','硕士','博士']; for(var j=0;j<items.length;j++){for(var i=0;i<opts.length;i++){if(opts[i].innerText.trim()==items[j]){opts[i].click();break}}} String('done')"
	return resultText
end tell