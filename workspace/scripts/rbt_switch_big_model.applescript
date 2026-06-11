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
	
	set out to ""
	
	-- Step 1: Find and click dropdown trigger (any element showing current job)
	set js1 to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var items=doc.querySelectorAll('span');for(var i=0;i<items.length;i++){var t=items[i].innerText;if(t.indexOf('Agent ')>=0&&t.indexOf('开发工程')>=0&&t.length<60&&items[i].offsetHeight>0){items[i].click();return 'trigger_clicked';}}return 'trigger_not_found';})()"
	set r1 to execute tab_ javascript js1
	set out to out & r1
	delay 1
	
	-- Step 2: Click big model job item
	set js2 to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var items=doc.querySelectorAll('li.job-item');for(var i=0;i<items.length;i++){var t=items[i].innerText;if(t.indexOf('大模型算法工程师-工业智能')>=0&&items[i].offsetHeight>0){items[i].scrollIntoView();items[i].click();return 'job_clicked';}}return 'job_not_found';})()"
	set r2 to execute tab_ javascript js2
	set out to out & '|' & r2
	delay 2
	
	-- Verify: check active job
	set js3 to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var active=doc.querySelector('li.job-item.active');if(active)return 'active:'+active.innerText.substring(0,30);var spans=doc.querySelectorAll('span');for(var i=0;i<spans.length;i++){if(spans[i].innerText.indexOf('大模型')>=0&&spans[i].className.indexOf('label')>=0)return 'found_bigmodel_label';}return 'no_confirmation';})()"
	set r3 to execute tab_ javascript js3
	set out to out & '|' & r3
	
	return out
end tell