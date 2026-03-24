import { Module } from '@nestjs/common';
import { CpcService } from './cpc.service';

@Module({
    providers: [CpcService],
    exports: [CpcService],
})
export class CpcModule { }
