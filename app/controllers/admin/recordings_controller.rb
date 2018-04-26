module Admin
  class RecordingsController < AdminControllerBase
    def index
      @groups = GroupFilter.filter(params)
        .order(:display_title)
        .limit(200)
        .includes(
          compositions: [
            :composers,
            :title,
            inclusions: [
              :source,
            ]
          ],
        )
    end

    def update_for_group
      group = Group.find(params[:group_id])

      unless group.update(group_params)
        flash[:error] = group.errors.full_messages.to_sentence
      end

      redirect_to admin_recordings_path(request.query_parameters.except(:group_id))
    end

    private

    def group_params
      params.require(:group).permit(
        recordings_attributes: [
          :performer_id,
          :file_url,
          :id,
        ]
      )
    end
  end
end
