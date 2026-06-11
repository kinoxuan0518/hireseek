tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument||iframe.contentWindow.document; var text=doc.body.innerText; var idx=text.indexOf('徐睿'); if(idx>=0){String(text.substring(idx, idx+500))}else{String('not_found')}"
	return resultText
end tell