import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import * as Workspace from '../shared/workspace.js';
Object.assign(window,{marked,DOMPurify,Workspace,BackupZip:{zipSync,unzipSync,strToU8,strFromU8}});
