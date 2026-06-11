tell application "Google Chrome"
	set tab_ to null
	repeat with w from 1 to count of windows
		repeat with t from 1 to count of tabs of window w
			if URL of tab t of window w contains "zhipin.com/web/chat" then
				set tab_ to tab t of window w
				exit repeat
			end if
		end repeat
		if tab_ is not null then exit repeat
	end repeat
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var btns=doc.querySelectorAll('div');for(var i=0;i<btns.length;i++){if(btns[i].innerText.indexOf('取消')>=0&&btns[i].className.indexOf('recover')>=0){btns[i].click();return 'cancel_clicked';}}var allDivs=doc.querySelectorAll('.filter-wrap div');for(var i=0;i<allDivs.length;i++){if(allDivs[i].innerText.trim()==='取消'){allDivs[i].click();return 'cancel_fallback_clicked';}}return 'cancel_not_found';})()"
	set r to execute tab_ javascript js
	delay 1
	set js2 to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var txt=doc.querySelector('.filter-wrap').innerText.substring(0,200);return 'txt='+txt;})()"
	set r2 to execute tab_ javascript js2
	return r & ' ' & r2
end tell
