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
	
	-- Step 1: Click all DIVs containing "Agent 开发工程师" to trigger dropdown
	set js1 to (do shell script "cat /Users/blacklake/hireclaw/workspace/scripts/click_agent_label.js")
	set r1 to execute tab_ javascript js1
	delay 1
	
	-- Step 2: Click big model job
	set js2 to (do shell script "cat /Users/blacklake/hireclaw/workspace/scripts/click_bigmodel_job.js")
	set r2 to execute tab_ javascript js2
	delay 2
	
	return r1 & " | " & r2
end tell