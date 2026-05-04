import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { AuthService, User } from '../../core/services/auth.service';

@Component({
  selector: 'app-admin',
  imports: [FormsModule],
  templateUrl: './admin.html',
  styleUrl: './admin.scss',
})
export class Admin {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly users = signal<User[]>([]);
  readonly error = signal<string | null>(null);

  newName = '';
  newPassword = '';
  newIsAdmin = false;
  newApiKeys = '';

  constructor() {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    try {
      this.users.set(await this.auth.listUsers());
    } catch (e: unknown) {
      this.error.set(this.formatError(e, 'Failed to load users'));
    }
  }

  async create(): Promise<void> {
    this.error.set(null);
    try {
      const apiKeys = this.newApiKeys
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      await this.auth.createUser({
        name: this.newName,
        password: this.newPassword,
        apiKeys,
        isAdmin: this.newIsAdmin,
      });
      this.newName = '';
      this.newPassword = '';
      this.newIsAdmin = false;
      this.newApiKeys = '';
      await this.refresh();
    } catch (e: unknown) {
      this.error.set(this.formatError(e, 'Failed to create user'));
    }
  }

  async remove(id: number): Promise<void> {
    if (!confirm('Delete user?')) return;
    try {
      await this.auth.deleteUser(id);
      await this.refresh();
    } catch (e: unknown) {
      this.error.set(this.formatError(e, 'Failed to delete user'));
    }
  }

  back(): void {
    this.router.navigate(['/dashboard']);
  }

  private formatError(e: unknown, fallback: string): string {
    if (typeof e === 'object' && e !== null && 'error' in e) {
      const err = (e as { error?: { error?: string } }).error;
      if (err?.error) return err.error;
    }
    return e instanceof Error ? e.message : fallback;
  }
}
