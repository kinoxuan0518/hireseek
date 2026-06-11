tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument || iframe.contentWindow.document; var fp=doc.querySelector('.filter-panel'); if(fp) { String(fp.innerText.substring(0,3000)) } else { String('no panel') }"
	return resultText
end tell