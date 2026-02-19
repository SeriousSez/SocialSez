import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { PostComposerComponent } from '../../shared/post-composer/post-composer.component';

@Component({
    selector: 'app-compose-page',
    standalone: true,
    imports: [CommonModule, PostComposerComponent],
    templateUrl: './compose-page.component.html',
    styleUrl: './compose-page.component.scss'
})
export class ComposePageComponent { }