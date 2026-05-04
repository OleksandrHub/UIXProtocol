import {
  AfterViewInit,
  Component,
  ElementRef,
  computed,
  inject,
  viewChild,
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard implements AfterViewInit {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly frame = viewChild.required<ElementRef<HTMLIFrameElement>>('frame');

  readonly proxyUrl: SafeResourceUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
    `${window.location.protocol}//${window.location.hostname}:${environment.port}/`
  );
  readonly name = computed(() => this.auth.user()?.name ?? '');
  readonly isAdmin = this.auth.isAdmin;

  ngAfterViewInit(): void {
    const allow = environment.iframePermissions.map((p) => `${p} *`).join('; ');
    this.frame().nativeElement.setAttribute('allow', allow);
  }

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
