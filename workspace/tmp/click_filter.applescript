tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument || iframe.contentWindow.document; var fl=doc.querySelector('.filter-label'); if(fl) { fl.click(); String('clicked') } else { String('not_found') }"
	return resultText
end tell