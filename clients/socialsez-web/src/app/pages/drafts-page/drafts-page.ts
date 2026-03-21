import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PostDto, ReelDto, StoryDto } from '../../core/api.types';
import { SessionService } from '../../core/session.service';
import { ConfirmModalComponent } from '../../shared/confirm-modal/confirm-modal.component';
import { SegmentedTabItem, SegmentedTabsComponent } from '../../shared/segmented-tabs/segmented-tabs.component';

type DraftType = 'posts' | 'reels' | 'stories';
type DeleteDraftTarget = { kind: 'post' | 'reel' | 'story'; id: string };

@Component({
  selector: 'app-drafts-page',
  standalone: true,
  imports: [CommonModule, RouterLink, SegmentedTabsComponent, ConfirmModalComponent],
  templateUrl: './drafts-page.html',
  styleUrl: './drafts-page.scss',
})
export class DraftsPageComponent implements OnInit {
  readonly session = inject(SessionService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  isLoading = true;
  openingDraftId: string | null = null;
  deletingDraftId: string | null = null;
  pendingDeleteDraft: DeleteDraftTarget | null = null;
  activeTab: DraftType = 'posts';
  postDrafts: PostDto[] = [];
  reelDrafts: ReelDto[] = [];
  storyDrafts: StoryDto[] = [];
  readonly skeletonItems = [1, 2, 3, 4];
  readonly contentTabs: readonly SegmentedTabItem[] = [
    { id: 'posts', label: 'Posts' },
    { id: 'reels', label: 'Reels' },
    { id: 'stories', label: 'Stories' }
  ];

  get activeCount(): number {
    if (this.activeTab === 'reels') {
      return this.reelDrafts.length;
    }

    if (this.activeTab === 'stories') {
      return this.storyDrafts.length;
    }

    return this.postDrafts.length;
  }

  ngOnInit(): void {
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(params => {
        const tabParam = params.get('type');
        if (tabParam === 'posts' || tabParam === 'reels' || tabParam === 'stories') {
          this.activeTab = tabParam;
        } else {
          this.activeTab = 'posts';
        }
      });

    void this.loadDraftsAsync();
  }

  onContentTabChanged(tabId: string): void {
    if (tabId !== 'posts' && tabId !== 'reels' && tabId !== 'stories') {
      return;
    }

    this.activeTab = tabId;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { type: tabId === 'posts' ? null : tabId },
      queryParamsHandling: 'merge'
    });
  }

  async editPostDraft(post: PostDto): Promise<void> {
    if (this.deletingDraftId || this.pendingDeleteDraft) {
      return;
    }

    this.openingDraftId = post.id;
    this.cdr.detectChanges();

    try {
      const mediaUrls = post.imageUrls?.length
        ? post.imageUrls
        : post.imageUrl
          ? [post.imageUrl]
          : [];
      const mediaFiles = await Promise.all(mediaUrls.map((url, index) => this.fetchFileFromUrlAsync(url, `post-media-${index + 1}`)));

      this.session.setPendingPostComposerDraft({
        sourceDraftId: post.id,
        content: post.content ?? '',
        contentIsHtml: true,
        markSensitive: post.isSensitive === true,
        scheduledPublishLocal: this.toLocalDateTimeInputValue(post.scheduledPublishAtUtc),
        mediaFiles
      });

      await this.router.navigate(['/feed'], { queryParams: { compose: 'post' } });
    } catch {
      this.session.message = 'Could not reopen that post draft right now.';
    } finally {
      this.openingDraftId = null;
      this.cdr.detectChanges();
    }
  }

  async editReelDraft(reel: ReelDto): Promise<void> {
    if (this.deletingDraftId || this.pendingDeleteDraft) {
      return;
    }

    this.openingDraftId = reel.id;
    this.cdr.detectChanges();

    try {
      const reelVideoFile = await this.fetchFileFromUrlAsync(reel.videoUrl, 'reel-video');
      const reelThumbnailFile = reel.thumbnailUrl
        ? await this.fetchFileFromUrlAsync(reel.thumbnailUrl, 'reel-thumbnail')
        : undefined;

      this.session.setPendingReelComposerDraft({
        sourceDraftId: reel.id,
        reelCaption: reel.caption ?? '',
        reelLocation: '',
        reelCollaborators: '',
        markSensitive: reel.isSensitive === true,
        scheduledPublishLocal: this.toLocalDateTimeInputValue(reel.scheduledPublishAtUtc),
        reelVideoFile,
        reelThumbnailFile
      });

      await this.router.navigate(['/feed'], { queryParams: { compose: 'reel' } });
    } catch {
      this.session.message = 'Could not reopen that reel draft right now.';
    } finally {
      this.openingDraftId = null;
      this.cdr.detectChanges();
    }
  }

  async editStoryDraft(story: StoryDto): Promise<void> {
    if (this.deletingDraftId || this.pendingDeleteDraft) {
      return;
    }

    this.openingDraftId = story.id;
    this.cdr.detectChanges();

    try {
      const storyMediaFile = await this.fetchFileFromUrlAsync(story.mediaUrl, 'story-media');

      this.session.setPendingStoryComposerDraft({
        sourceDraftId: story.id,
        markSensitive: story.isSensitive === true,
        scheduledPublishLocal: this.toLocalDateTimeInputValue(story.scheduledPublishAtUtc),
        storyMediaFile
      });

      await this.router.navigate(['/feed'], { queryParams: { compose: 'story' } });
    } catch {
      this.session.message = 'Could not reopen that story draft right now.';
    } finally {
      this.openingDraftId = null;
      this.cdr.detectChanges();
    }
  }

  requestDeletePostDraft(post: PostDto, event: Event): void {
    event.stopPropagation();
    this.pendingDeleteDraft = { kind: 'post', id: post.id };
  }

  requestDeleteReelDraft(reel: ReelDto, event: Event): void {
    event.stopPropagation();
    this.pendingDeleteDraft = { kind: 'reel', id: reel.id };
  }

  requestDeleteStoryDraft(story: StoryDto, event: Event): void {
    event.stopPropagation();
    this.pendingDeleteDraft = { kind: 'story', id: story.id };
  }

  cancelDeleteDraft(): void {
    if (this.deletingDraftId) {
      return;
    }

    this.pendingDeleteDraft = null;
  }

  async confirmDeleteDraft(): Promise<void> {
    const pending = this.pendingDeleteDraft;
    if (!pending || this.deletingDraftId) {
      return;
    }

    this.deletingDraftId = pending.id;
    this.cdr.detectChanges();

    try {
      if (pending.kind === 'post') {
        await this.session.deletePostAsync(pending.id);
        this.postDrafts = this.postDrafts.filter(item => item.id !== pending.id);
      } else if (pending.kind === 'reel') {
        await this.session.deleteReelAsync(pending.id);
        this.reelDrafts = this.reelDrafts.filter(item => item.id !== pending.id);
      } else {
        await this.session.deleteStoryAsync(pending.id);
        this.storyDrafts = this.storyDrafts.filter(item => item.id !== pending.id);
      }
    } catch {
      this.session.message = 'Could not delete draft right now.';
    } finally {
      this.deletingDraftId = null;
      this.pendingDeleteDraft = null;
      this.cdr.detectChanges();
    }
  }

  get deleteDraftModalTitle(): string {
    if (this.pendingDeleteDraft?.kind === 'reel') {
      return 'Delete reel draft';
    }

    if (this.pendingDeleteDraft?.kind === 'story') {
      return 'Delete story draft';
    }

    return 'Delete post draft';
  }

  get deleteDraftModalMessage(): string {
    return 'Delete this draft? This action cannot be undone.';
  }

  private async loadDraftsAsync(): Promise<void> {
    this.isLoading = true;
    this.cdr.detectChanges();

    try {
      const [posts, reels, stories] = await Promise.all([
        this.session.loadMyPostDraftsAsync(100),
        this.session.loadMyReelDraftsAsync(100),
        this.session.loadMyStoryDraftsAsync(100)
      ]);

      this.postDrafts = posts;
      this.reelDrafts = reels;
      this.storyDrafts = stories;
    } catch {
      this.session.message = 'Failed to load drafts.';
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  private async fetchFileFromUrlAsync(url: string, fallbackName: string): Promise<File> {
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) {
      throw new Error(`Could not load ${url}`);
    }

    const blob = await response.blob();
    const fileName = this.getFileNameFromUrl(url, fallbackName);
    return new File([blob], fileName, { type: blob.type || undefined });
  }

  private getFileNameFromUrl(url: string, fallbackName: string): string {
    try {
      const parsed = new URL(url, window.location.origin);
      const candidate = parsed.pathname.split('/').pop()?.trim();
      return candidate ? decodeURIComponent(candidate) : fallbackName;
    } catch {
      return fallbackName;
    }
  }

  private toLocalDateTimeInputValue(utcValue?: string): string {
    if (!utcValue) {
      return '';
    }

    const parsed = new Date(utcValue);
    if (Number.isNaN(parsed.getTime())) {
      return '';
    }

    const offsetMs = parsed.getTimezoneOffset() * 60000;
    return new Date(parsed.getTime() - offsetMs).toISOString().slice(0, 16);
  }

}
