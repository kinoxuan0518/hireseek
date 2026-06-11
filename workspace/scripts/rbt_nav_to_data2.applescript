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
	
	set js to "(function(){var items=document.querySelectorAll('a');for(var i=0;i<items.length;i++){var t=items[i].innerText;if(t.indexOf('数据')>=0&&items[i].offsetHeight>0){items[i].click();return 'clicked_'+t.trim();}}return 'not_found';})()"
	set r to execute tab_ javascript js
	delay 2
	
	set js2 to "(function(){var iframes=document.querySelectorAll('iframe');for(var i=0;i<iframes.length;i++){var txt=iframes[i].contentDocument.body.innerText;if(txt&&txt.length>100){return txt.substring(0,300);}}return 'no_data_iframe';})()"
	set r2 to execute tab_ javascript js2
	return r & ' | ' & r2
end tell