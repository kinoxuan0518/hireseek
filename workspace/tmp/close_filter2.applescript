tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument||iframe.contentWindow.document; var btns=doc.querySelectorAll('.btn.confirm-btn'); var r='no_confirm_btn'; if(btns.length>0){btns[0].click();r='confirmed'} String(r)"
	return resultText
end tell