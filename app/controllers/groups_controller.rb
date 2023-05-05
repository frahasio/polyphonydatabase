class GroupsController < ApplicationController
  def index
    @groups = GroupFilter.filter(params)
      .order(:display_title)
      .limit(100)
      .includes(
        :composers,
        :editions,
        :functions,
        :recordings,
        compositions: [
          inclusions: [
            :attributions,
            :clef_combination,
            :source,
          ],
        ],
      )
  end
end
