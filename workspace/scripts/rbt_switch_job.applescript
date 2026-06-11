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
	
	-- Click on 大模型算法工程师-工业智能
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var items=doc.querySelectorAll('a,div,span');for(var i=0;i<items.length;i++){if(items[i].innerText.indexOf('大模型算法工程师-工业智能')>=0&&items[i].offsetHeight>0){items[i].scrollIntoView();items[i].click();return 'clicked_big_model';}}return 'not_found';})()"
	set r to execute tab_ javascript js
	delay 2
	
	-- check current job
	set js2 to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var active=doc.querySelector('.job-item.active')||doc.querySelector('.active');if(active){return active.innerText.substring(0,40);}return 'no_active';})()"
	set r2 to execute tab_ javascript js2
	return r & ' | ' & r2
end tell