/**
 * Owner-only publisher management: invite a Trusted Publisher, disable or
 * re-enable an account. Server functions re-verify the Owner role on every
 * call — this screen is convenience, not authority.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { studioGetOverview, studioInviteMember, studioSetMemberActive } from "../studio.functions";
import { STUDIO_OVERVIEW_KEY } from "./StudioDashboard";

export function StudioMembers() {
  const queryClient = useQueryClient();
  const overview = useQuery({
    queryKey: STUDIO_OVERVIEW_KEY,
    queryFn: () => studioGetOverview(),
    retry: false,
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: () => studioInviteMember({ data: { email, password, displayName } }),
    onSuccess: () => {
      setMessage(`Invited ${email}. Share the password with them directly.`);
      setEmail("");
      setPassword("");
      setDisplayName("");
      void queryClient.invalidateQueries({ queryKey: STUDIO_OVERVIEW_KEY });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Invitation failed."),
  });
  const setActive = useMutation({
    mutationFn: (input: { userId: string; isActive: boolean }) =>
      studioSetMemberActive({ data: input }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: STUDIO_OVERVIEW_KEY }),
    onError: (error) => setMessage(error instanceof Error ? error.message : "Update failed."),
  });

  if (overview.isPending) {
    return <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>;
  }
  if (overview.isError || overview.data.session.role !== "owner") {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Only the Owner manages publishers.
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-xl font-semibold">Publishers</h1>
        <ul className="space-y-2">
          {overview.data.members.map((member) => (
            <li
              key={member.userId}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{member.displayName ?? member.email}</p>
                <p className="text-xs text-muted-foreground">{member.email}</p>
              </div>
              <Badge variant={member.role === "owner" ? "default" : "secondary"}>
                {member.role === "owner" ? "Owner" : "Publisher"}
              </Badge>
              <Badge variant={member.isActive ? "secondary" : "destructive"}>
                {member.isActive ? "Active" : "Disabled"}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                disabled={setActive.isPending}
                onClick={() =>
                  setActive.mutate({ userId: member.userId, isActive: !member.isActive })
                }
              >
                {member.isActive ? "Disable" : "Enable"}
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Invite a Trusted Publisher
        </h2>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            invite.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="invite-name">Name (optional)</Label>
            <Input
              id="invite-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="invite-password">Temporary password (10+ characters)</Label>
            <Input
              id="invite-password"
              type="text"
              required
              minLength={10}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={invite.isPending}>
            {invite.isPending ? "Inviting…" : "Invite publisher"}
          </Button>
          {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        </form>
        <p className="text-xs text-muted-foreground">
          Publishers can add and update projects, prices, media, and resale listings, and publish
          immediately. There is no public self-registration.
        </p>
      </section>
    </div>
  );
}
