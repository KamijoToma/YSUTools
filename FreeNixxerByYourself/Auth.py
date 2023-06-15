# This file is for YSU Universal Login Server.
import base64
import json
import os.path
import pickle
import random
import time

import requests
from bs4 import BeautifulSoup
from requests_toolbelt import MultipartEncoder


def login():
    '''
    Login into YSU CAS
    :return: session that contains cookies
    '''
    session = requests.session()
    session.headers[
        'User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'

    # Get authlogin
    result = session.get(
        'https://cer.ysu.edu.cn/authserver/login?service=http%3a%2f%2f202.206.247.60%2fAbout%2fUnifiedAuthenticationLogin')
    if not result.status_code == 200:
        print("Auth server forbidden to login")
        exit(1)
    soup = BeautifulSoup(result.text, 'lxml')
    lt_v = soup.find('input', attrs={'name': 'lt'})['value']
    dllt_v = soup.find('input', attrs={'name': 'dllt'})['value']
    execution_v = soup.find('input', attrs={'name': 'execution'})['value']
    event_id_v = soup.find('input', attrs={'name': '_eventId'})['value']
    rmShown_v = soup.find('input', attrs={'name': 'rmShown'})['value']
    pwdSalt = soup.find('input', attrs={'id': 'pwdDefaultEncryptSalt'})['value']
    print(pwdSalt)

    # Generate password
    import sys
    import os
    username = os.getenv('USERNAME', False)
    password = os.getenv('PASSWORD', False)
    if not username or not password:
        exit(2)
    from Encrypt import encryptAES
    pwdEcy = encryptAES(password, pwdSalt)

    # Construct dict
    workload = {
        'username': username,
        'password': pwdEcy,
        'lt': lt_v,
        'dllt': dllt_v,
        'execution': execution_v,
        '_eventId': event_id_v,
        'rmShown': rmShown_v
    }

    # Detect captcha
    capt_result = session.get(
        f'https://cer.ysu.edu.cn/authserver/needCaptcha.html?username={username}&pwdEncrypt2=pwdEncryptSalt&_={int(time.time())}')
    if 'true' in capt_result.text:
        # Pend capt_result
        captimg_result = session.get(f'https://cer.ysu.edu.cn/authserver/captcha.html?ts={random.randint(1, 999)}')
        img_base64 = str(base64.b64encode(captimg_result.content), 'utf-8')
        # Send it to YesCaptcha
        data = {
            "clientKey": os.getenv('YESCAPTCHA_KEY'),
            "task":
                {
                    "type": "ImageToTextTaskTest",
                    "body": img_base64  # base64编码后的图片
                }
        }
        r = requests.post("https://api.yescaptcha.com/createTask", json=data).json()
        if not 'ready' in r['status']:
            print(r)
            exit(3)
        code: str = r['solution']['text']
        workload['captchaResponse'] = code.strip()

    result1 = session.post(
        'https://cer.ysu.edu.cn/authserver/login?service=http%3a%2f%2f202.206.247.60%2fAbout%2fUnifiedAuthenticationLogin',
        data=workload)
    print(result1.status_code)
    if not len(result1.history) == 3:
        # Failed
        exit(4)
    return session


def load_from_file(filename='cookies'):
    session = requests.session()
    session.headers[
        'User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
    if not os.path.exists(filename):
        return session
    with open(filename, 'rb') as f:
        session.cookies = pickle.load(f)
        pass
    return session


def save_to_file(session: requests.Session, filename='cookies'):
    with open(filename, 'wb+') as f:
        pickle.dump(session.cookies, f)
        pass

def getActivities(session: requests.Session)->tuple:
    '''
    Get activities list
    :param session: account session
    :return: tumple contains an activities list and a RVS token used to submit form.
    '''
    enroll_result = session.get('http://202.206.247.60/XueFen/Enroll/Index')
    soup1 = BeautifulSoup(enroll_result.text, 'lxml')
    tbody = soup1.find(name='tbody')
    assert not tbody is None
    # Get list
    all_elect = []
    for item in tbody.find_all('tr'):
        col_list = []
        for col in item.find_all('td'):
            col_list.append(col.string.strip() if not col.string is None else col.string)
            pass
        # Find ID
        col_list.append(item.find('td-data', attrs={'data-name': 'ID'})['data-value'])
        all_elect.append(col_list)
        pass
    rvt = soup1.find('input', attrs={'name': '__RequestVerificationToken'})['value'].strip()
    return all_elect, rvt

def enroll(id, rvt, session) -> requests.Response:
    '''
    Enroll an activity
    :param id: act id, see return value of getActivities()[0][-1]
    :param rvt: RequestVerficationToken
    :param session: Account session
    :return: Response used to check result.
    '''
    # Perform request
    formData = MultipartEncoder(fields={
        'id': id,
        '__RequestVerificationToken': rvt
    })
    session.headers['Content-Type'] = formData.content_type
    session.headers['__RequestVerificationToken'] = rvt
    return session.post('http://202.206.247.60/XueFen/Enroll/SubmitEnroll', data=formData.to_string())

if __name__ == '__main__':
    session: requests.Session = load_from_file()
    post1_result = session.post('http://202.206.247.60/About/UnifiedAuthenticationLogin')
    if not 'true' in post1_result.text:
        # Cookie timeout
        # Login
        print('Re-logging in...')
        session = login()
        save_to_file(session)
        post1_result = session.post('http://202.206.247.60/About/UnifiedAuthenticationLogin')
        if not 'true' in post1_result.text:
            # Sys fail
            print('Re-login failed.')
            exit(4)
            pass
        pass
    r = getActivities(session)
    # Filter
    activity = list(filter(lambda x: '图书馆' in x[2], r[0]))
    if not os.path.exists('activities'):
        # Save and exit
        with open('activities', 'w+') as f:
            json.dump(activity, f)
            pass
    else:
        # Check diff
        with open('activities', 'r') as f:
            old = json.load(f)
            pass
        diff = set(activity).difference(set(old))
        if len(diff) == 0:
            print('No more new activities.')
        else:
            for i in diff:
                break
                resp = enroll(i[-1], r[1], session)
                if not 'true' in resp.text:
                    print('Enroll failed: ', i)
                    pass
                pass
            # Send notice...
            print('Notice: subscribed: ', diff)
            pass
        pass
    pass