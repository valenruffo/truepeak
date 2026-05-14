import os

def fix_file(path, pattern):
    if not os.path.exists(path):
        print(f"File {path} not found")
        return
    
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Replace /pattern/ with /
    new_content = content.replace(f'/{pattern}/', '/')
    # Replace /pattern" with "
    new_content = new_content.replace(f'/{pattern}"', '"')
    
    with open(path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print(f"Fixed {path}")

# Fix Labels
fix_file('backend/app/api/labels.py', 'labels')
# Fix Submissions
fix_file('backend/app/api/submissions.py', 'submissions')
# Fix Email
fix_file('backend/app/api/email.py', 'email')
